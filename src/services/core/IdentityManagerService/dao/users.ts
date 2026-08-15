import type { Model } from "mongoose";
import type { User, LinkedAccount, DeletionReason } from "@common/types/identity/User.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import {
	generateId,
	hashPassword,
	verifyPassword,
	needsPasswordRehash,
	sha256Hex,
	sha256Bytes,
	hmacSha256Hex,
	safeEqualHex,
	shortId,
} from "@common/utils/crypto.ts";
import { type AuthVerifierGetter, PermissionChecker } from "@common/types/auth-verifier.ts";
import { IdentityScopes, RESOURCE_NAME } from "@common/types/identity/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.ts";
import { REMOTE_AVATAR_URL_PATTERN, isRemoteAvatarUrl, resolveUserAvatar } from "@common/utils/avatar.ts";
import { escapeRegex } from "@common/utils/escape.ts";
import { buildUpdateSet } from "@common/utils/mongo-update.ts";
import { USER_UPDATABLE_FIELDS } from "../domain/user.js";
import { type AccountTier, type TierGrant, isTierGrantActive } from "@common/types/tiers.ts";
import { UNLIMITED } from "@common/types/plans/index.ts";
import { IdentityError } from "@common/types/custom-errors/IdentityError.ts";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import type { SeatGate } from "@common/types/plans/consumers.js";

export type UserAuthenticationResult = Partial<User> | { id: string; isActive: boolean } | { id: string; wrongPassword: boolean } | null;

/** Máximo de perfiles públicos por petición (mitiga scraping/DoS en endpoints sin auth). */
const MAX_PUBLIC_PROFILES = 50;
/** Límite por defecto de resultados de búsqueda de usuarios. */
const DEFAULT_SEARCH_LIMIT = 10;
/** Máximo duro de resultados de búsqueda (se clampa en el DAO, aunque el endpoint valide). */
const MAX_SEARCH_LIMIT = 50;
/** Máximo duro de un listado de usuarios (una respuesta sin límite es un DoS accidental). */
const MAX_LIST_LIMIT = 500;

/** Corta a propósito: el token viaja a una casilla todavía NO verificada. */
const EMAIL_CHANGE_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * El username es identidad pública y de él se deriva la dirección de correo: rotarlo sin freno
 * habilita suplantaciones y rompe referencias. 30 días permite rectificar sin rotar.
 */
const USERNAME_CHANGE_COOLDOWN_DAYS = 30;

/** Cambio de email pendiente de confirmación (`metadata.emailChangePending`). */
interface EmailChangePending {
	newEmail: string;
	/**
	 * SHA-256 hex del token completo (un solo uso). **Ausente** en el marcador que deja
	 * {@link UserManager.markEmailChangeUnconfirmable}: ahí no hay nada que confirmar y la falta
	 * de hash es justamente lo que impide canjearlo.
	 */
	tokenHash?: string;
	requestedAt: Date | string;
	expiresAt: Date | string;
}

/**
 * Corta las sesiones vivas de una cuenta que se acaba de desactivar. Lo provee el
 * servicio (que sí puede resolver `SessionManagerService`); el DAO sólo lo invoca.
 * Best-effort: un fallo acá nunca puede abortar el ban.
 */
export type SessionRevoker = (userId: string, reason: string) => Promise<void>;

/**
 * Da de baja el débito automático de la cuenta que se está eliminando. Lo provee el
 * servicio (que sí puede resolver `SubscriptionService`, que vive en un preset y
 * puede no estar cargado); el DAO sólo lo invoca. Best-effort: un fallo acá no puede
 * abortar la baja de cuenta, pero tampoco puede pasar en silencio.
 */
export type SubscriptionCanceller = (userId: string) => Promise<void>;

/**
 * Aviso de que una baja voluntaria se canceló al volver a entrar. Lo provee el servicio (que sí
 * puede resolver notificaciones y auditoría); el DAO sólo lo dispara, best-effort y sin `await`.
 */
export type SelfDeletionCancelledHook = (userId: string, via: "login") => void;

/**
 * `true` si la cuenta está inactiva sólo porque su titular pidió irse y la ventana de
 * arrepentimiento no venció.
 *
 * Excluye las cuentas con `bannedAt` —un ban temporal conserva la metadata de una baja previa, y
 * sin este guard volver a entrar levantaría la sanción— y la retención ya vencida, donde la purga
 * puede estar corriendo y reactivar sería peor que rechazar.
 */
function hasPendingSelfDeletion(user: Pick<User, "isActive" | "metadata">): boolean {
	if (user.isActive) return false;
	const meta = (user.metadata ?? {}) as Record<string, unknown>;
	if (meta.bannedAt || meta.deletionReason !== ("self" satisfies DeletionReason)) return false;
	const scheduled = meta.scheduledDeletionAt;
	if (typeof scheduled !== "string" && !(scheduled instanceof Date)) return false;
	return new Date(scheduled).getTime() > Date.now();
}

export class UserManager {
	readonly #permissionChecker: PermissionChecker;

	readonly #seatGate: SeatGate;

	readonly #revokeSessions: SessionRevoker;

	readonly #cancelSubscription: SubscriptionCanceller;

	readonly #onSelfDeletionCancelled: SelfDeletionCancelledHook;

	/** Firma los tokens de arrepentimiento. `null` = sin secreto: no se emiten y el canje falla. */
	readonly #cancelTokenKey: Uint8Array | null;

	/** Sub-clave del mismo secreto para los tokens de cambio de email. `null` = flujo deshabilitado. */
	readonly #emailChangeKey: Uint8Array | null;

	constructor(
		private readonly userModel: Model<any>,
		private readonly logger: ILogger,
		getAuthVerifier: AuthVerifierGetter = () => null,
		seatGate: SeatGate = async () => null,
		revokeSessions: SessionRevoker = async () => {},
		cancelSubscription: SubscriptionCanceller = async () => {},
		deletionSecret?: string,
		onSelfDeletionCancelled: SelfDeletionCancelledHook = () => {}
	) {
		this.#permissionChecker = new PermissionChecker(getAuthVerifier, "UserManager", RESOURCE_NAME);
		this.#seatGate = seatGate;
		this.#revokeSessions = revokeSessions;
		this.#cancelSubscription = cancelSubscription;
		this.#onSelfDeletionCancelled = onSelfDeletionCancelled;
		this.#cancelTokenKey = deletionSecret ? sha256Bytes(`account-deletion-cancel:${deletionSecret}`) : null;
		this.#emailChangeKey = deletionSecret ? sha256Bytes(`email-change-confirm:${deletionSecret}`) : null;
	}

	/**
	 * Desactivar una cuenta tiene que terminar sus sesiones: `isActive:false` por sí solo
	 * no invalida nada, y sin esto el refresh token se sigue canjeando por access tokens
	 * nuevos indefinidamente. Se llama en TODA transición a `isActive:false` (ban, baja voluntaria).
	 */
	async #revokeSessionsSafe(userId: string, reason: string): Promise<void> {
		try {
			await this.#revokeSessions(userId, reason);
		} catch (error) {
			this.logger.logError(`No se pudieron revocar las sesiones de ${userId} (${reason}): ${error}`);
		}
	}

	/**
	 * Autentica un usuario con username y password
	 * No requiere token (es el proceso de login)
	 */
	async authenticate(username: string, password: string): Promise<UserAuthenticationResult> {
		try {
			const doc = await this.userModel.findOne({ username });
			const user: User | null = doc?.toObject?.() || doc || null;

			if (!user) return null;

			// La credencial se valida ANTES de mirar el estado de la cuenta. Al revés el login es un
			// oráculo: un `ACCOUNT_DISABLED` confirmaría que la cuenta existe y está baneada sin
			// credencial y sin pasar por el contador de intentos fallidos.
			if (!(await verifyPassword(password, user.passwordHash))) return { id: user.id, wrongPassword: true };

			// Ya probada la credencial, una baja VOLUNTARIA vigente no rechaza: volver a entrar la
			// cancela, que es la vía que no depende del correo (y la única de las cuentas sin
			// email). Ban y baja administrativa siguen rechazando.
			let target = user;
			if (!target.isActive) {
				if (!hasPendingSelfDeletion(target)) return { id: target.id, isActive: false };
				target = await this.#clearScheduledDeletion(target);
				this.#onSelfDeletionCancelled(target.id, "login");
			}

			target.lastLogin = new Date();
			// Rehash oportunista al hash vigente, montado sobre la escritura de `lastLogin` que este
			// login ya hace (es el único momento con la contraseña en claro y ya validada). Va por
			// escritura directa porque el update genérico no admite `passwordHash`. Un fallo NO puede
			// tumbar el login —la credencial ya se validó— y no emite el aviso de "contraseña
			// cambiada": nadie la cambió, y ese aviso se leería como alerta de compromiso.
			const update: Record<string, unknown> = { lastLogin: target.lastLogin };
			if (needsPasswordRehash(user.passwordHash)) {
				try {
					update.passwordHash = await hashPassword(password);
				} catch (error) {
					this.logger.logWarn(`No se pudo rehashear la contraseña de ${target.id} (sigue el hash anterior): ${error}`);
				}
			}
			await this.userModel.findOneAndUpdate({ id: target.id }, update);

			return target;
		} catch (error) {
			this.logger.logError(`Error autenticando usuario: ${error}`);
			return null;
		}
	}

	/**
	 * Crea un nuevo usuario
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async createUser(username: string, password: string, roleIds?: string[], token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, IdentityScopes.USERS);

		try {
			const userId = generateId();
			const user: User = {
				id: userId,
				username,
				passwordHash: await hashPassword(password),
				roleIds: roleIds || [],
				groupIds: [],
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await this.userModel.create(user);
			this.logger.logDebug(`Usuario creado: ${username}`);
			return user;
		} catch (error: any) {
			if (error.code === 11000) {
				throw new Error(`Usuario ${username} ya existe`, { cause: error });
			}
			throw error;
		}
	}

	/**
	 * Obtiene un usuario por ID
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getUser(userId: string, token?: string): Promise<User | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS, {
			allowIf: async (callerId) => callerId === userId,
		});

		try {
			const doc = await this.userModel.findOne({ id: userId });
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error obteniendo usuario: ${error}`);
			return null;
		}
	}

	/**
	 * Devuelve datos públicos mínimos para mostrar perfiles (avatar + username)
	 * de un conjunto de usuarios. Sin verificación de permisos: estos campos
	 * ya son públicos cuando un usuario aparece como autor de un comentario,
	 * artículo, etc. Limita la cardinalidad para mitigar abusos.
	 */
	async getPublicProfiles(userIds: readonly string[]): Promise<Map<string, { username?: string; avatar: string | null }>> {
		const out = new Map<string, { username?: string; avatar: string | null }>();
		const ids = Array.from(new Set(userIds.filter(Boolean))).slice(0, MAX_PUBLIC_PROFILES);
		if (ids.length === 0) return out;
		try {
			const docs = await this.userModel
				.find({ id: { $in: ids } })
				.select({ id: 1, username: 1, avatar: 1, metadata: 1, linkedAccounts: 1 })
				.lean();
			for (const d of docs as any[]) {
				out.set(d.id, { username: d.username, avatar: resolveUserAvatar(d) ?? null });
			}
		} catch (error) {
			this.logger.logError(`Error obteniendo perfiles públicos: ${error}`);
		}
		return out;
	}

	/**
	 * Obtiene un usuario por username
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getUserByUsername(username: string, token?: string): Promise<User | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		try {
			const doc = await this.userModel.findOne({ username });
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error obteniendo usuario por username: ${error}`);
			return null;
		}
	}

	/* Check if an username is already in use. No Permisson required */
	async existUserByName(username: string): Promise<boolean> {
		try {
			const doc = await this.userModel.findOne({ username });
			return !!doc;
		} catch (error) {
			this.logger.logError(`Error obteniendo usuario por username: ${error}`);
			return false;
		}
	}

	/**
	 * Obtiene un usuario por email
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getUserByEmail(email: string, token?: string): Promise<User | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		try {
			const doc = await this.userModel.findOne({ email });
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error obteniendo usuario por email: ${error}`);
			return null;
		}
	}

	/**
	 * Busca usuario por providerId en metadata O por email (query optimizada)
	 * Útil para login OAuth donde el usuario puede existir por provider previo o por email
	 */
	async findByProviderIdOrEmail(providerIdField: string, providerId: string, email?: string, token?: string): Promise<User | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		try {
			const conditions: any[] = [{ [`metadata.${providerIdField}`]: providerId }];
			if (email) {
				conditions.push({ email });
			}
			const doc = await this.userModel.findOne({ $or: conditions });
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error buscando usuario por provider o email: ${error}`);
			return null;
		}
	}

	// Linked Accounts (OAuth external providers)

	/**
	 * Busca usuario por linked account (provider + providerId con status "linked")
	 * Reemplaza búsqueda por metadata.discordId
	 */
	async findByLinkedExternalAccount(provider: string, providerId: string, token?: string): Promise<User | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		try {
			const doc = await this.userModel.findOne({
				linkedAccounts: {
					$elemMatch: { provider, providerId, status: "linked" },
				},
			});
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error buscando usuario por linked account: ${error}`);
			return null;
		}
	}

	/**
	 * Vincula una cuenta externa al usuario.
	 * Valida que no exista otro usuario con ese providerId activo para el mismo provider.
	 */
	async linkExternalAccount(userId: string, account: LinkedAccount, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		// Anti-collision: verificar que ningún OTRO usuario tiene este provider+id activo
		const existing = await this.userModel.findOne({
			id: { $ne: userId },
			linkedAccounts: {
				$elemMatch: { provider: account.provider, providerId: account.providerId, status: "linked" },
			},
		});
		if (existing) {
			throw new Error(`La cuenta ${account.provider}:${account.providerId} ya está vinculada a otro usuario`);
		}

		// Verificar si ya existe una entrada para este provider (puede estar "unlinked")
		const userDoc = await this.userModel.findOne({
			id: userId,
			"linkedAccounts.provider": account.provider,
			"linkedAccounts.providerId": account.providerId,
		});

		if (userDoc) {
			// Re-vincular: cambiar status a "linked", actualizar linkedAt y datos
			const updated = await this.userModel.findOneAndUpdate(
				{
					id: userId,
					linkedAccounts: {
						$elemMatch: { provider: account.provider, providerId: account.providerId },
					},
				},
				{
					$set: {
						"linkedAccounts.$.status": "linked",
						"linkedAccounts.$.linkedAt": new Date(),
						"linkedAccounts.$.providerUsername": account.providerUsername,
						"linkedAccounts.$.providerAvatar": account.providerAvatar,
						"linkedAccounts.$.unlinkedAt": undefined,
					},
					updatedAt: new Date(),
				},
				{ new: true }
			);
			if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
			this.logger.logDebug(`Cuenta ${account.provider} re-vinculada para usuario ${userId}`);
			return updated.toObject?.() || updated;
		}

		// Nueva vinculación: push al array
		const updated = await this.userModel.findOneAndUpdate(
			{ id: userId },
			{
				$push: {
					linkedAccounts: {
						provider: account.provider,
						providerId: account.providerId,
						providerUsername: account.providerUsername,
						providerAvatar: account.providerAvatar,
						status: "linked",
						linkedAt: new Date(),
					},
				},
				updatedAt: new Date(),
			},
			{ new: true }
		);
		if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
		this.logger.logDebug(`Cuenta ${account.provider} vinculada para usuario ${userId}`);
		return updated.toObject?.() || updated;
	}

	/**
	 * Desvincula una cuenta externa (cambia status a "unlinked", no elimina la entrada)
	 */
	async unlinkExternalAccount(userId: string, provider: string, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		const updated = await this.userModel.findOneAndUpdate(
			{
				id: userId,
				linkedAccounts: {
					$elemMatch: { provider, status: "linked" },
				},
			},
			{
				$set: {
					"linkedAccounts.$.status": "unlinked",
					"linkedAccounts.$.unlinkedAt": new Date(),
				},
				updatedAt: new Date(),
			},
			{ new: true }
		);

		if (!updated) throw new Error(`No se encontró cuenta ${provider} vinculada para usuario ${userId}`);
		this.logger.logDebug(`Cuenta ${provider} desvinculada para usuario ${userId}`);
		return updated.toObject?.() || updated;
	}

	/**
	 * Actualiza un usuario
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async updateUser(userId: string, updates: Partial<User>, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		try {
			const update = buildUpdateSet(updates, USER_UPDATABLE_FIELDS, { updatedAt: new Date() });
			const updated = await this.userModel.findOneAndUpdate({ id: userId }, update, { new: true });
			if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
			// `isActive: false` por esta vía es la desactivación administrativa: mismo corte de
			// sesiones que un ban (`updates.isActive` ya pasó por el allowlist de buildUpdateSet).
			if (updates.isActive === false) await this.#revokeSessionsSafe(userId, "desactivación");
			return updated.toObject?.() || updated;
		} catch (error) {
			this.logger.logError(`Error actualizando usuario: ${error}`);
			throw error;
		}
	}

	/**
	 * Actualiza (merge shallow por clave top-level) el objeto `metadata` del propio usuario.
	 */
	async updateOwnMetadata(userId: string, partial: Record<string, unknown>, token?: string): Promise<User> {
		const callerId = await this.#permissionChecker.resolveUserId(token);
		if (callerId && callerId !== userId) {
			throw new Error(`[UserManager] No se puede actualizar metadata de otro usuario (caller=${callerId}, target=${userId})`);
		}
		const current = await this.userModel.findOne({ id: userId });
		if (!current) throw new Error(`Usuario ${userId} no encontrado`);
		const currentMeta = (current.toObject?.() || current).metadata || {};
		const nextMeta = { ...currentMeta, ...partial };
		const updated = await this.userModel.findOneAndUpdate({ id: userId }, { metadata: nextMeta, updatedAt: new Date() }, { new: true });
		if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
		return updated.toObject?.() || updated;
	}

	/**
	 * Otorga (o renueva) un upgrade temporal de tier — recompensa de bug bounty u
	 * otro beneficio acotado. Setea `metadata.accountTier = tier` y guarda el grant
	 * en `metadata.tierGrant`; el cron de reversión lo revierte a `previousTier` al
	 * expirar. Requiere permiso UPDATE sobre usuarios (admin/Security Manager).
	 *
	 * Si ya hay un grant vigente, preserva su `previousTier` original (para no
	 * "congelar" un tier otorgado como base al revertir).
	 */
	async grantTemporaryTier(userId: string, tier: AccountTier, days: number, reason: string | undefined, token?: string): Promise<TierGrant> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		if (!Number.isFinite(days) || days <= 0) throw new Error("`days` debe ser un entero positivo");

		const current = await this.userModel.findOne({ id: userId });
		if (!current) throw new Error(`Usuario ${userId} no encontrado`);
		const meta = (current.toObject?.() || current).metadata || {};

		const existing = meta.tierGrant as TierGrant | undefined;
		const previousTier: AccountTier =
			existing && isTierGrantActive(existing) ? existing.previousTier : ((meta.accountTier as AccountTier) ?? "free");

		const now = new Date();
		const grant: TierGrant = {
			tier,
			previousTier,
			grantedAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
			reason,
		};

		const nextMeta = { ...meta, accountTier: tier, tierGrant: grant };
		await this.userModel.findOneAndUpdate({ id: userId }, { metadata: nextMeta, updatedAt: now });
		this.logger.logInfo(`Tier grant: ${userId} → ${tier} por ${days}d (${reason ?? "sin motivo"})`);
		return grant;
	}

	/**
	 * Página de usuarios con un grant de tier vencido (`metadata.tierGrant.expiresAt <= now`),
	 * cursor por `id` ascendente (para `forEachPage`). Lo consume el cron de reversión
	 * vía el manager interno (sin token).
	 */
	async findUsersDueForTierRevertPage(
		afterId: string | null,
		limit: number,
		now: Date = new Date(),
		token?: string
	): Promise<Array<{ id: string }>> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);
		const filter: Record<string, unknown> = { "metadata.tierGrant.expiresAt": { $lte: now.toISOString() } };
		if (afterId) filter.id = { $gt: afterId };
		const docs = await this.userModel
			.find(filter, { id: 1, _id: 0 })
			.sort({ id: 1 })
			.limit(Math.min(Math.max(limit, 1), MAX_LIST_LIMIT))
			.lean();
		return docs.map((d: any) => ({ id: d.id }));
	}

	/**
	 * Revierte un grant de tier vencido: restaura `accountTier = previousTier` y
	 * elimina `metadata.tierGrant`. Idempotente (si no hay grant vencido, no-op).
	 */
	async revertExpiredTierGrant(userId: string, now: Date = new Date(), token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);
		const current = await this.userModel.findOne({ id: userId });
		if (!current) return;
		const meta = (current.toObject?.() || current).metadata || {};
		const grant = meta.tierGrant as TierGrant | undefined;
		if (!grant || isTierGrantActive(grant, now)) return;

		const nextMeta = { ...meta, accountTier: grant.previousTier };
		delete (nextMeta as Record<string, unknown>).tierGrant;
		await this.userModel.findOneAndUpdate({ id: userId }, { metadata: nextMeta, updatedAt: new Date() });
		this.logger.logInfo(`Tier grant revertido: ${userId} → ${grant.previousTier}`);
	}

	/**
	 * Verifica la password de un usuario
	 */
	async verifyUserPassword(userId: string, password: string): Promise<boolean> {
		try {
			const doc = await this.userModel.findOne({ id: userId });
			const user = doc?.toObject?.() || doc;

			if (!user) return false;

			return await verifyPassword(password, user.passwordHash);
		} catch (error) {
			this.logger.logError(`Error verificando password: ${error}`);
			return false;
		}
	}

	/**
	 * Actualiza la password de un usuario
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async updatePassword(userId: string, newPassword: string, token?: string): Promise<void> {
		if (token) {
			await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);
		}

		try {
			const passwordHash = await hashPassword(newPassword);

			const updated = await this.userModel.findOneAndUpdate(
				{ id: userId },
				{
					$set: { passwordHash, updatedAt: new Date() },
					// Es el remedio que recomienda la alerta `security.email_change_requested`, así que
					// invalida el cambio pendiente: si no, el token de la sesión robada vive 60 min más.
					$unset: { "metadata.emailChangePending": "" },
				}
			);

			if (!updated) {
				throw new Error(`Usuario ${userId} no encontrado`);
			}

			this.logger.logDebug(`Password actualizada para usuario ${userId}`);
		} catch (error) {
			this.logger.logError(`Error actualizando password: ${error}`);
			throw error;
		}
	}

	/**
	 * Baja ADMINISTRATIVA: mismo flujo que la voluntaria (desactivar + revocar sesiones + cancelar
	 * débito + `scheduledDeletionAt`), NUNCA un borrado directo — la cascada la hace siempre el
	 * stepper. `retentionDays = 0` la deja vencida ya mismo (variante `immediate`). No la cancela
	 * la persona; la revierte un admin reactivando vía PUT.
	 */
	async scheduleAdminDeletion(userId: string, retentionDays = 30, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.USERS);

		const current = await this.userModel.findOne({ id: userId });
		if (!current) throw new Error(`Usuario ${userId} no encontrado`);
		const userObj = (current.toObject?.() || current) as User;
		const now = new Date();
		const nextMeta: Record<string, unknown> = {
			...(userObj.metadata || {}),
			deletionRequestedAt: now,
			deletionReason: "admin" satisfies DeletionReason,
			scheduledDeletionAt: new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000),
		};
		// Un token de arrepentimiento previo deja de valer: esta baja no la cancela la persona.
		delete nextMeta.deletionCancelTokenHash;

		const updated = await this.userModel.findOneAndUpdate(
			{ id: userId },
			{ isActive: false, metadata: nextMeta, updatedAt: now },
			{ new: true }
		);
		if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
		await this.#revokeSessionsSafe(userId, "baja administrativa");
		try {
			await this.#cancelSubscription(userId);
		} catch (error) {
			this.logger.logError(`Baja administrativa ${userId}: NO se pudo cancelar la suscripción, revisar cobro recurrente: ${error}`);
		}
		this.logger.logInfo(`Baja administrativa programada: ${userId} (${retentionDays}d)`);
		return updated.toObject?.() || updated;
	}

	/**
	 * Borrado físico CONDICIONAL: sólo si la cuenta sigue inactiva y con la retención vencida. El
	 * filtro va en la query y no en el caller, así que ningún caller puede saltear la cascada ni
	 * borrar una baja cancelada a último momento. Único uso legítimo: el paso final del stepper.
	 */
	async hardDeleteDueUser(userId: string, now: Date = new Date(), token?: string): Promise<boolean> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.USERS);

		try {
			const res = await this.userModel.deleteOne({ id: userId, isActive: false, "metadata.scheduledDeletionAt": { $lte: now } });
			const deleted = (res?.deletedCount ?? 0) > 0;
			if (deleted) this.logger.logDebug(`Usuario eliminado (retención vencida): ${userId}`);
			return deleted;
		} catch (error) {
			this.logger.logError(`Error eliminando usuario: ${error}`);
			throw error;
		}
	}

	/**
	 * Marca a un usuario como baneado:
	 *  - `isActive = false`
	 *  - `metadata.bannedAt`, `metadata.banReason`, `metadata.banExpiresAt`
	 *  - sólo si el ban es PERMANENTE: `metadata.scheduledDeletionAt = now + 30d`
	 *
	 * No toca la ban-list (lo hace el orquestador en ModerationService).
	 * Requiere `IdentityScopes.USERS` UPDATE.
	 */
	async banUser(userId: string, args: { reason: string; expiresAt?: Date | null; retentionDays?: number }, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		const current = await this.userModel.findOne({ id: userId });
		if (!current) throw new Error(`Usuario ${userId} no encontrado`);
		const userObj = (current.toObject?.() || current) as User;
		const currentMeta = userObj.metadata || {};
		const now = new Date();
		const retentionMs = (args.retentionDays ?? 30) * 24 * 60 * 60 * 1000;

		const nextMeta: Record<string, unknown> = {
			...currentMeta,
			bannedAt: now,
			banReason: args.reason,
			banExpiresAt: args.expiresAt ?? null,
		};
		// Sólo el ban PERMANENTE programa la baja. Un ban TEMPORAL es una sanción de la que la
		// cuenta tiene que sobrevivir: sin este guard, uno de 7 días sin unban manual terminaba en
		// purga al día 30 (nada limpia `scheduledDeletionAt` al vencer el ban).
		if (!args.expiresAt) {
			nextMeta.deletionReason = "ban" satisfies DeletionReason;
			nextMeta.scheduledDeletionAt = new Date(now.getTime() + retentionMs);
			// El ban absorbe una baja voluntaria en curso: no se cancela con un enlace de email.
			delete nextMeta.deletionCancelTokenHash;
		}

		const updated = await this.userModel.findOneAndUpdate(
			{ id: userId },
			{ isActive: false, metadata: nextMeta, updatedAt: now },
			{ new: true }
		);
		if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
		await this.#revokeSessionsSafe(userId, "ban");
		this.logger.logInfo(`Usuario baneado: ${userId} (reason="${args.reason}")`);
		return updated.toObject?.() || updated;
	}

	/**
	 * Revierte el ban de un usuario: reactiva la cuenta y limpia metadatos de ban.
	 */
	async unbanUser(userId: string, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		const current = await this.userModel.findOne({ id: userId });
		if (!current) throw new Error(`Usuario ${userId} no encontrado`);
		const userObj = (current.toObject?.() || current) as User;
		const currentMeta = { ...userObj.metadata };
		delete (currentMeta as any).bannedAt;
		delete (currentMeta as any).banReason;
		delete (currentMeta as any).banExpiresAt;
		delete (currentMeta as any).scheduledDeletionAt;
		delete (currentMeta as any).deletionReason;
		delete (currentMeta as any).deletionRequestedAt;
		delete (currentMeta as any).deletionCancelTokenHash;

		const updated = await this.userModel.findOneAndUpdate(
			{ id: userId },
			{ isActive: true, metadata: currentMeta, updatedAt: new Date() },
			{ new: true }
		);
		if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
		this.logger.logInfo(`Usuario desbaneado: ${userId}`);
		return updated.toObject?.() || updated;
	}

	/**
	 * Auto-eliminación: desactiva la cuenta y programa el borrado, que ejecuta el cron de retención.
	 *
	 * Emite el **token de arrepentimiento** (HMAC de un solo uso, válido hasta
	 * `scheduledDeletionAt`) que viaja por email: la baja revoca las sesiones, así que el enlace es
	 * la otra vía de cancelación. Da de baja además el débito automático **personal** —si no, la
	 * cuenta queda programada para borrarse y se le sigue cobrando—; las suscripciones de una
	 * organización no se tocan, son de la organización.
	 */
	async requestSelfDeletion(
		userId: string,
		note?: string,
		retentionDays = 30,
		token?: string
	): Promise<{ user: User; cancelToken: string | null }> {
		const callerId = await this.#permissionChecker.resolveUserId(token);
		if (callerId && callerId !== userId) {
			throw new Error(`No se puede solicitar borrado de otro usuario (caller=${callerId}, target=${userId})`);
		}

		const current = await this.userModel.findOne({ id: userId });
		if (!current) throw new Error(`Usuario ${userId} no encontrado`);
		const userObj = (current.toObject?.() || current) as User;
		const currentMeta = userObj.metadata || {};
		const now = new Date();
		const scheduledDeletionAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
		const issued = this.#issueCancelToken(userId, scheduledDeletionAt);
		const nextMeta = {
			...currentMeta,
			deletionRequestedAt: now,
			deletionReason: "self" satisfies DeletionReason,
			deletionNote: note || null,
			scheduledDeletionAt,
			...(issued ? { deletionCancelTokenHash: issued.tokenHash } : {}),
		};
		const updated = await this.userModel.findOneAndUpdate(
			{ id: userId },
			{ isActive: false, metadata: nextMeta, updatedAt: now },
			{ new: true }
		);
		if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
		await this.#revokeSessionsSafe(userId, "baja voluntaria");
		try {
			await this.#cancelSubscription(userId);
		} catch (error) {
			// La baja de cuenta ya está hecha y no se revierte por esto, pero queda el rastro
			// para que operaciones cancele el cobro a mano antes del próximo débito.
			this.logger.logError(`Baja de cuenta ${userId}: NO se pudo cancelar la suscripción, revisar cobro recurrente: ${error}`);
		}
		this.logger.logInfo(`Usuario solicita borrado: ${userId}`);
		return { user: updated.toObject?.() || updated, cancelToken: issued?.token ?? null };
	}

	/**
	 * Limpia la metadata de baja y reactiva la cuenta. Autorizado para la propia persona o para un
	 * admin con UPDATE; qué bajas puede cancelar la persona lo decide la capa de endpoints.
	 */
	async cancelScheduledDeletion(userId: string, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS, {
			allowIf: async (callerId) => callerId === userId,
		});

		const current = await this.userModel.findOne({ id: userId });
		if (!current) throw new Error(`Usuario ${userId} no encontrado`);
		const userObj = (current.toObject?.() || current) as User;
		if (!(userObj.metadata as Record<string, unknown> | undefined)?.scheduledDeletionAt) {
			throw new IdentityError(409, "NOT_CANCELLABLE", "No hay una baja programada para cancelar");
		}
		return this.#clearScheduledDeletion(userObj);
	}

	/**
	 * Canje del token de arrepentimiento (público, sin sesión): HMAC, vigencia, un solo uso y baja
	 * todavía VOLUNTARIA. Cualquier fallo responde el mismo error, sin oráculo de cuál falló.
	 */
	async cancelSelfDeletionByToken(rawToken: string): Promise<User> {
		const invalid = () => new IdentityError(400, "INVALID_CANCEL_TOKEN", "El enlace de cancelación no es válido, ya se usó o venció");
		if (!this.#cancelTokenKey) throw invalid();

		const userId = this.#verifyHmacToken(this.#cancelTokenKey, rawToken);
		if (!userId) throw invalid();

		const doc = await this.userModel.findOne({ id: userId });
		const user = (doc?.toObject?.() || doc || null) as User | null;
		const meta = (user?.metadata ?? {}) as Record<string, unknown>;
		if (!user || meta.deletionReason !== ("self" satisfies DeletionReason) || !meta.scheduledDeletionAt) throw invalid();
		const storedHash = typeof meta.deletionCancelTokenHash === "string" ? meta.deletionCancelTokenHash : null;
		if (!storedHash || !safeEqualHex(storedHash, sha256Hex(rawToken))) throw invalid();

		return this.#clearScheduledDeletion(user);
	}

	/**
	 * Cancela la baja voluntaria vigente de una cuenta que YA probó su identidad por otra vía;
	 * `null` si no había baja cancelable. Es el equivalente OAuth de lo que hace `authenticate` en
	 * el login nativo, y la única prueba posible para una cuenta creada por OAuth (su password es
	 * aleatorio). Primitiva pre-auth: no verifica nada por sí misma, de ahí que quede fuera de
	 * `PublicUserManager`.
	 */
	async cancelSelfDeletionOnLogin(userId: string): Promise<User | null> {
		const doc = await this.userModel.findOne({ id: userId });
		const user = (doc?.toObject?.() || doc || null) as User | null;
		if (!user || !hasPendingSelfDeletion(user)) return null;

		const restored = await this.#clearScheduledDeletion(user);
		this.#onSelfDeletionCancelled(userId, "login");
		return restored;
	}

	/** Token `base64url(userId.expiraMs.nonce).hmacHex`; se guarda sólo su SHA-256 (un solo uso). */
	#issueCancelToken(userId: string, expiresAt: Date): { token: string; tokenHash: string } | null {
		if (!this.#cancelTokenKey) return null;
		return this.#issueHmacToken(this.#cancelTokenKey, userId, expiresAt);
	}

	/** Emisión genérica de un token HMAC de un solo uso (mismo formato para baja y cambio de email). */
	#issueHmacToken(key: Uint8Array, userId: string, expiresAt: Date): { token: string; tokenHash: string } {
		const payload = `${userId}.${expiresAt.getTime()}.${shortId()}`;
		const token = `${Buffer.from(payload, "utf8").toString("base64url")}.${hmacSha256Hex(payload, key)}`;
		return { token, tokenHash: sha256Hex(token) };
	}

	/**
	 * Verifica firma y vigencia de un token emitido con `#issueHmacToken` y devuelve el
	 * `userId` del payload, o `null` ante cualquier fallo (sin oráculo de cuál chequeo falló).
	 */
	#verifyHmacToken(key: Uint8Array, rawToken: string): string | null {
		const dot = rawToken.lastIndexOf(".");
		if (dot <= 0) return null;
		const sig = rawToken.slice(dot + 1);
		let payload: string;
		try {
			payload = Buffer.from(rawToken.slice(0, dot), "base64url").toString("utf8");
		} catch {
			return null;
		}
		if (!safeEqualHex(sig, hmacSha256Hex(payload, key))) return null;

		const [userId, expiresAtMs] = payload.split(".");
		const expiry = Number(expiresAtMs);
		if (!userId || !Number.isFinite(expiry) || Date.now() > expiry) return null;
		return userId;
	}

	// ── Rectificación self-service (art. 16 Ley 25.326 / art. 16 RGPD) ─────────

	/**
	 * Solicita el cambio de email propio. No toca `email`: deja el pedido en
	 * `metadata.emailChangePending` y emite un token de un solo uso para la casilla NUEVA; el
	 * cambio se aplica recién en {@link confirmEmailChangeByToken}, que es lo que prueba el control
	 * de esa casilla. Un pedido nuevo pisa al anterior. Unicidad y password: capa de endpoints.
	 */
	async requestEmailChange(userId: string, newEmail: string, token?: string): Promise<{ confirmToken: string; expiresAt: Date }> {
		const callerId = await this.#permissionChecker.resolveUserId(token);
		if (callerId && callerId !== userId) {
			throw new Error(`No se puede pedir el cambio de email de otro usuario (caller=${callerId}, target=${userId})`);
		}
		if (!this.#emailChangeKey) {
			throw new IdentityError(503, "EMAIL_DELIVERY_UNAVAILABLE", "El cambio de email no está habilitado en este despliegue");
		}

		const current = await this.userModel.findOne({ id: userId });
		if (!current) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		const userObj = (current.toObject?.() || current) as User;

		const now = new Date();
		const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_TOKEN_TTL_MS);
		const issued = this.#issueHmacToken(this.#emailChangeKey, userId, expiresAt);
		const pending: EmailChangePending = { newEmail, tokenHash: issued.tokenHash, requestedAt: now, expiresAt };
		const nextMeta = { ...(userObj.metadata || {}), emailChangePending: pending };
		await this.userModel.findOneAndUpdate({ id: userId }, { metadata: nextMeta, updatedAt: now });
		this.logger.logInfo(`Cambio de email solicitado por ${userId} (pendiente de confirmación)`);
		return { confirmToken: issued.token, expiresAt };
	}

	/**
	 * Marca un pedido de email pendiente SIN token, con la misma forma y la misma vigencia que el
	 * real. Lo usa la vinculación neutral cuando la dirección ya es de otra cuenta: no hay nada que
	 * confirmar, pero la cuenta tiene que verse idéntica a la del caso libre hasta que el pedido
	 * venza — si no, la propia pantalla de "Mi cuenta" sería el oráculo que el endpoint evita.
	 */
	async markEmailChangeUnconfirmable(userId: string, newEmail: string): Promise<void> {
		const current = await this.userModel.findOne({ id: userId });
		if (!current) return;
		const userObj = (current.toObject?.() || current) as User;
		const now = new Date();
		const pending: EmailChangePending = { newEmail, requestedAt: now, expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TOKEN_TTL_MS) };
		const nextMeta = { ...(userObj.metadata || {}), emailChangePending: pending };
		await this.userModel.findOneAndUpdate({ id: userId }, { metadata: nextMeta, updatedAt: now });
	}

	/**
	 * Canje del token de confirmación (público, sin sesión): HMAC, vigencia, un solo uso y cuenta
	 * activa, con el mismo error para todos los fallos. Re-chequea la unicidad al aplicar: entre el
	 * pedido y el canje otra cuenta pudo registrar esa dirección.
	 */
	async confirmEmailChangeByToken(rawToken: string): Promise<{ user: User; previousEmail: string | null }> {
		const invalid = () => new IdentityError(400, "INVALID_EMAIL_CHANGE_TOKEN", "El enlace de confirmación no es válido, ya se usó o venció");
		if (!this.#emailChangeKey) throw invalid();

		const userId = this.#verifyHmacToken(this.#emailChangeKey, rawToken);
		if (!userId) throw invalid();

		const doc = await this.userModel.findOne({ id: userId });
		const user = (doc?.toObject?.() || doc || null) as User | null;
		const meta = (user?.metadata ?? {}) as Record<string, unknown>;
		const pending = meta.emailChangePending as EmailChangePending | undefined;
		// Cuenta desactivada (ban/baja): el cambio pendiente deja de valer.
		if (!user || !user.isActive || !pending?.newEmail || typeof pending.tokenHash !== "string") throw invalid();
		if (!safeEqualHex(pending.tokenHash, sha256Hex(rawToken))) throw invalid();

		// Este 409 NO es un oráculo de existencia, a diferencia del que se sacó del alta y del pedido
		// de cambio: para llegar acá hay que traer el token de un solo uso que se envió a ESA casilla,
		// o sea haber probado ya que se la controla. Quien la controla puede averiguar por vías más
		// directas si tiene cuenta; lo que no puede hacer nadie es preguntar por una casilla ajena.
		const taken = await this.userModel.findOne({ email: pending.newEmail, id: { $ne: userId } }, { id: 1, _id: 0 }).lean();
		if (taken) throw new AuthError(409, "EMAIL_EXISTS", "Ese email ya está registrado en otra cuenta");

		const nextMeta = { ...meta };
		delete nextMeta.emailChangePending;
		const updated = await this.userModel.findOneAndUpdate(
			{ id: userId },
			{ email: pending.newEmail, metadata: nextMeta, updatedAt: new Date() },
			{ new: true }
		);
		if (!updated) throw invalid();
		this.logger.logInfo(`Email de ${userId} actualizado por confirmación`);
		return { user: updated.toObject?.() || updated, previousEmail: user.email ?? null };
	}

	/**
	 * Cambia el username propio, con cooldown de {@link USERNAME_CHANGE_COOLDOWN_DAYS} días. La
	 * carrera de unicidad la corta el índice único (11000), no el pre-chequeo. Política de nombres
	 * y password: capa de endpoints, igual que en el alta.
	 */
	async changeOwnUsername(userId: string, newUsername: string, token?: string): Promise<User> {
		const callerId = await this.#permissionChecker.resolveUserId(token);
		if (callerId && callerId !== userId) {
			throw new Error(`No se puede cambiar el username de otro usuario (caller=${callerId}, target=${userId})`);
		}

		const current = await this.userModel.findOne({ id: userId });
		if (!current) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		const userObj = (current.toObject?.() || current) as User;
		const meta = (userObj.metadata || {}) as Record<string, unknown>;

		const rawLast = meta.lastUsernameChangeAt;
		const lastMs = typeof rawLast === "string" || rawLast instanceof Date ? new Date(rawLast).getTime() : 0;
		const cooldownMs = USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
		if (lastMs > 0 && Date.now() - lastMs < cooldownMs) {
			const nextAllowedAt = new Date(lastMs + cooldownMs);
			throw new IdentityError(429, "USERNAME_CHANGE_COOLDOWN", "Sólo se puede cambiar el nombre de usuario una vez cada 30 días", {
				retryAfterSeconds: Math.ceil((nextAllowedAt.getTime() - Date.now()) / 1000),
				nextAllowedAt: nextAllowedAt.toISOString(),
			});
		}

		const now = new Date();
		const nextMeta = { ...meta, lastUsernameChangeAt: now.toISOString() };
		try {
			const updated = await this.userModel.findOneAndUpdate(
				{ id: userId },
				{ username: newUsername, metadata: nextMeta, updatedAt: now },
				{ new: true }
			);
			if (!updated) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
			this.logger.logInfo(`Username de ${userId} cambiado a '${newUsername}'`);
			return updated.toObject?.() || updated;
		} catch (error: any) {
			if (error?.code === 11000) {
				throw new AuthError(409, "USERNAME_EXISTS", `El nombre de usuario '${newUsername}' ya está en uso`);
			}
			throw error;
		}
	}

	/** Limpieza compartida de la metadata de baja + reactivación de la cuenta. */
	async #clearScheduledDeletion(current: User): Promise<User> {
		const nextMeta = { ...(current.metadata || {}) } as Record<string, unknown>;
		delete nextMeta.scheduledDeletionAt;
		delete nextMeta.deletionRequestedAt;
		delete nextMeta.deletionReason;
		delete nextMeta.deletionNote;
		delete nextMeta.deletionCancelTokenHash;
		const updated = await this.userModel.findOneAndUpdate(
			{ id: current.id },
			{ isActive: true, metadata: nextMeta, updatedAt: new Date() },
			{ new: true }
		);
		if (!updated) throw new Error(`Usuario ${current.id} no encontrado`);
		this.logger.logInfo(`Baja de cuenta cancelada: ${current.id}`);
		return updated.toObject?.() || updated;
	}

	/**
	 * Usuario sólo si su baja sigue VIGENTE (cuenta inactiva y `scheduledDeletionAt`
	 * vencido). Guard del stepper de purga: entre el listado de vencidos y cada paso
	 * la baja pudo cancelarse (token de arrepentimiento, reactivación admin).
	 */
	async findDueUser(userId: string, now: Date = new Date(), token?: string): Promise<User | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);
		const doc = await this.userModel.findOne({ id: userId, isActive: false, "metadata.scheduledDeletionAt": { $lte: now } });
		return doc?.toObject?.() || doc || null;
	}

	/**
	 * Página de usuarios cuya retención expiró (`metadata.scheduledDeletionAt < now`),
	 * cursor por `id` ascendente (para `forEachPage`). Pensado para el cron de retención:
	 * se invoca a través del manager interno (construido con `getAuthVerifier = () => null`),
	 * donde `requirePermission` hace short-circuit y permite la operación sin token.
	 */
	async findUsersDueForDeletionPage(
		afterId: string | null,
		limit: number,
		now: Date = new Date(),
		token?: string
	): Promise<Array<{ id: string }>> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		const filter: Record<string, unknown> = { "metadata.scheduledDeletionAt": { $lte: now } };
		if (afterId) filter.id = { $gt: afterId };
		const docs = await this.userModel
			.find(filter, { id: 1, _id: 0 })
			.sort({ id: 1 })
			.limit(Math.min(Math.max(limit, 1), MAX_LIST_LIMIT))
			.lean();
		return docs.map((d: any) => ({ id: d.id }));
	}

	/**
	 * Obtiene todos los usuarios, opcionalmente filtrados por orgId
	 * @param token Token de autenticación (requerido para verificar permisos)
	 * @param orgId Si se proporciona, filtra usuarios que pertenecen a esta organización
	 */
	/**
	 * Listado paginado de usuarios (orden estable por `username`), con filtro opcional
	 * por org y por texto (`q` sobre username/email). Devuelve `total` para que la UI
	 * pueda paginar; `limit` se clampa SIEMPRE a `MAX_LIST_LIMIT`.
	 */
	async getAllUsers(
		token?: string,
		orgId?: string,
		opts: { limit?: number; offset?: number; q?: string } = {}
	): Promise<{ items: User[]; total: number }> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS, orgId);

		try {
			const filter: Record<string, unknown> = orgId ? { "orgMemberships.orgId": orgId } : {};
			if (opts.q) {
				const regex = new RegExp(escapeRegex(opts.q), "i");
				filter.$or = [{ username: regex }, { email: regex }];
			}
			const limit = Math.min(Math.max(opts.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
			const offset = Math.max(opts.offset ?? 0, 0);
			const [docs, total] = await Promise.all([
				this.userModel.find(filter).sort({ username: 1 }).skip(offset).limit(limit),
				this.userModel.countDocuments(filter),
			]);
			return { items: docs.map((d: any) => d.toObject?.() || d), total };
		} catch (error) {
			this.logger.logError(`Error obteniendo usuarios: ${error}`);
			return { items: [], total: 0 };
		}
	}

	/**
	 * IDs de TODOS los usuarios activos (proyección lean, para broadcasts de
	 * notificaciones). Enumerar destinatarios es sensible: se expone sólo vía la
	 * superficie `_internal` (managers sin auth) o con permiso de lectura de usuarios.
	 */
	async getAllUserIds(token?: string): Promise<string[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);
		const docs = await this.userModel.find({ isActive: { $ne: false } }, { id: 1, _id: 0 }).lean();
		return docs.map((d: any) => d.id).filter(Boolean);
	}

	/**
	 * Cuántas cuentas activas hay por tier (`metadata.accountTier`, sin tier ⇒ `free`).
	 *
	 * Es un `$group` en la base, no un listado: contar los planes vendidos no puede
	 * costar traerse la colección de usuarios. Lo consume el control de capacidad de
	 * `PlanService`, que necesita saber cuánto hay **comprometido** antes de dejar
	 * vender un plan más.
	 */
	async countUsersByTier(token?: string): Promise<Record<string, number>> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);
		const rows = await this.userModel.aggregate<{ _id: unknown; count: number }>([
			{ $match: { isActive: { $ne: false } } },
			{ $group: { _id: { $ifNull: ["$metadata.accountTier", "free"] }, count: { $sum: 1 } } },
		]);
		const out: Record<string, number> = {};
		for (const row of rows) {
			// Un `metadata` con basura no puede romper la cuenta: se ignora la fila.
			if (typeof row._id === "string" && row._id) out[row._id] = row.count;
		}
		return out;
	}

	/**
	 * Página de IDs de usuarios activos (`id > afterId`, asc; contrato de `forEachPage`)
	 * para fan-outs por lotes. Misma sensibilidad que `getAllUserIds`.
	 */
	async getUserIdsPage(afterId: string | null, limit: number, token?: string): Promise<string[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);
		const query: Record<string, unknown> = { isActive: { $ne: false } };
		if (afterId) query.id = { $gt: afterId };
		const docs = await this.userModel
			.find(query, { id: 1, _id: 0 })
			.sort({ id: 1 })
			.limit(Math.min(Math.max(limit, 1), MAX_LIST_LIMIT))
			.lean();
		return docs.map((d: any) => d.id).filter(Boolean);
	}

	/**
	 * Busca usuarios por username o email (parcial, case-insensitive)
	 * @param query Texto a buscar
	 * @param limit Máximo de resultados (default 10)
	 * @param token Token de autenticación
	 * @param orgId Si se proporciona, filtra usuarios que pertenecen a esta organización
	 */
	async searchUsers(query: string, limit: number = DEFAULT_SEARCH_LIMIT, token?: string, orgId?: string): Promise<User[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS, orgId);

		try {
			const regex = new RegExp(escapeRegex(query), "i");
			const filter: any = { $or: [{ username: regex }, { email: regex }] };
			if (orgId) filter["orgMemberships.orgId"] = orgId;
			const docs = await this.userModel.find(filter).limit(Math.min(Math.max(limit, 1), MAX_SEARCH_LIMIT));
			return docs.map((d: any) => d.toObject?.() || d);
		} catch (error) {
			this.logger.logError(`Error buscando usuarios: ${error}`);
			return [];
		}
	}

	/**
	 * `attachmentId` del avatar custom de un usuario, o `null` si no tiene.
	 * Dato público (el avatar se sirve sin auth): pensado para el endpoint raw
	 * vía el manager interno, sin exponer el model a la capa HTTP.
	 */
	async getAvatarAttachmentId(userId: string, token?: string): Promise<string | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);
		const doc = await this.userModel.findOne({ id: userId }).select({ id: 1, metadata: 1 }).lean();
		if (!doc) return null;
		const meta = ((doc as { metadata?: unknown }).metadata ?? {}) as { customAvatar?: { attachmentId?: string } };
		return meta.customAvatar?.attachmentId ?? null;
	}

	/**
	 * Cuentas que todavía guardan la URL de avatar de un tercero, con la primera de esas URLs como
	 * pista de ingesta (misma precedencia que `resolveUserAvatar`). Sin cursor a propósito: lo
	 * consume el backfill de `avatarIngest.ts`, que limpia lo que procesa, así que la lista se
	 * vacía sola y volver a pedir la primera página siempre avanza.
	 */
	async findUsersWithRemoteAvatarPage(limit: number, token?: string): Promise<Array<{ id: string; remoteAvatarUrl?: string }>> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);
		const remote = { $regex: REMOTE_AVATAR_URL_PATTERN, $options: "i" };
		const docs = await this.userModel
			.find(
				{ $or: [{ "metadata.avatar": remote }, { "linkedAccounts.providerAvatar": remote }] },
				{ id: 1, "metadata.avatar": 1, "linkedAccounts.providerAvatar": 1, _id: 0 }
			)
			.sort({ id: 1 })
			.limit(Math.min(Math.max(limit, 1), MAX_LIST_LIMIT))
			.lean();

		const isRemote = (value: unknown): value is string => typeof value === "string" && isRemoteAvatarUrl(value);
		return docs.map((d: any) => {
			const metaAvatar = d.metadata?.avatar;
			const linked = (d.linkedAccounts ?? []).map((a: any) => a?.providerAvatar).find((url: unknown) => isRemote(url));
			return { id: d.id, remoteAvatarUrl: isRemote(metaAvatar) ? metaAvatar : linked };
		});
	}

	/**
	 * Deja la cuenta sin ninguna URL de avatar remota (`metadata.avatar` y los `providerAvatar` de
	 * las cuentas vinculadas) y, si la ingesta produjo un adjunto propio, lo deja seleccionado.
	 * Idempotente: es el cierre tanto del alta OAuth como del backfill.
	 */
	async clearRemoteAvatarRefs(userId: string, attachmentId: string | null = null, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);
		const current = await this.userModel.findOne({ id: userId });
		if (!current) return;
		const doc = (current.toObject?.() || current) as User;

		const metadata = { ...(doc.metadata || {}) } as Record<string, unknown>;
		delete metadata.avatar;
		if (attachmentId) {
			metadata.customAvatar = { attachmentId };
			metadata.avatarSource = "custom";
		}
		const linkedAccounts = (doc.linkedAccounts ?? []).map(({ providerAvatar: _remote, ...rest }) => rest);

		await this.userModel.updateOne({ id: userId }, { metadata, linkedAccounts, updatedAt: new Date() });
	}

	// Métodos de membresía por organización

	/**
	 * Tope de asientos: una organización no puede tener más miembros que asientos
	 * pagos. Es el gate que evita inflar el pool de recursos metiendo gente
	 * (los límites del eje org escalan con `paidSeats`).
	 *
	 * **Fail-open**: si `PlanService` no está cargado, el gate devuelve `null` y el
	 * alta procede. Nunca se bloquea una operación de identidad por un servicio
	 * de planes ausente.
	 *
	 * Re-agregar a alguien que ya es miembro no consume asiento (es idempotente).
	 */
	async #assertSeatAvailable(userId: string, orgId: string): Promise<void> {
		const seats = await this.#seatGate(orgId);
		if (!seats || seats.paidSeats === UNLIMITED) return;

		const existing = await this.userModel.findOne({ id: userId, "orgMemberships.orgId": orgId }, { id: 1, _id: 0 }).lean();
		if (existing) return;

		if (seats.activeSeats >= seats.paidSeats) {
			throw new IdentityError(403, "SEAT_LIMIT_REACHED", "La organización no tiene asientos disponibles", {
				paidSeats: seats.paidSeats,
				activeSeats: seats.activeSeats,
			});
		}
	}

	/**
	 * Agrega membresía a una organización
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async addOrgMembership(userId: string, orgId: string, roleIds: string[] = [], token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, IdentityScopes.USERS | IdentityScopes.ORGANIZATIONS, orgId);
		await this.#assertSeatAvailable(userId, orgId);

		try {
			const updated = await this.userModel.findOneAndUpdate(
				{ id: userId },
				{
					$addToSet: {
						orgMemberships: { orgId, roleIds, joinedAt: new Date() },
					},
					updatedAt: new Date(),
				},
				{ new: true }
			);
			if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
			this.logger.logDebug(`Usuario ${userId} agregado a organización ${orgId}`);
			return updated.toObject?.() || updated;
		} catch (error) {
			this.logger.logError(`Error agregando membresía de organización: ${error}`);
			throw error;
		}
	}

	/**
	 * Remueve membresía de una organización
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async removeOrgMembership(userId: string, orgId: string, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.USERS | IdentityScopes.ORGANIZATIONS, orgId);

		try {
			const updated = await this.userModel.findOneAndUpdate(
				{ id: userId },
				{
					$pull: { orgMemberships: { orgId } },
					updatedAt: new Date(),
				},
				{ new: true }
			);
			if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
			this.logger.logDebug(`Usuario ${userId} removido de organización ${orgId}`);
			return updated.toObject?.() || updated;
		} catch (error) {
			this.logger.logError(`Error removiendo membresía de organización: ${error}`);
			throw error;
		}
	}

	// Operaciones bulk / cascade (usadas por otros managers vía delegación)

	/**
	 * Remueve la membresía de una organización de TODOS los usuarios.
	 * Usado por OrgManager al eliminar una organización.
	 */
	async removeAllOrgMemberships(orgId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		await this.userModel.updateMany({ "orgMemberships.orgId": orgId }, { $pull: { orgMemberships: { orgId } }, updatedAt: new Date() });
	}

	/**
	 * IDs de usuarios que tienen el `roleId` (global) asignado directamente. `limit`
	 * acota el fan-out. Autorización READ sobre USERS (patrón dual-mode, como el resto
	 * del manager): el manager interno (`getAuthVerifier=()=>null`) hace short-circuit
	 * para los resolutores de infraestructura; el público exige token+permiso, cerrando
	 * la enumeración de usuarios por rol desde la superficie pública.
	 */
	async getUsersByRole(roleId: string, limit = 200, token?: string): Promise<string[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);
		if (!roleId) return [];
		const docs = await this.userModel
			.find({ roleIds: roleId, isActive: { $ne: false } }, { id: 1, _id: 0 })
			.limit(Math.min(Math.max(limit, 1), MAX_LIST_LIMIT))
			.lean<{ id: string }[]>();
		return docs.map((d) => d.id).filter(Boolean);
	}

	/**
	 * Remueve un roleId de TODOS los usuarios (roleIds directos + orgMemberships).
	 * Usado por RoleManager al eliminar un rol.
	 */
	async removeRoleFromAll(roleId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		await this.userModel.updateMany({ roleIds: roleId }, { $pull: { roleIds: roleId } });
		await this.userModel.updateMany({ "orgMemberships.roleIds": roleId }, { $pull: { "orgMemberships.$[].roleIds": roleId } });
	}

	/**
	 * Remueve un groupId de TODOS los usuarios.
	 * Usado por GroupManager al eliminar un grupo.
	 */
	async removeGroupFromAll(groupId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		await this.userModel.updateMany({ groupIds: groupId }, { $pull: { groupIds: groupId } });
	}

	// Operaciones de membresía a grupo (usadas por GroupManager vía delegación)

	/**
	 * Agrega un groupId al array groupIds de un usuario.
	 * Usado por GroupManager.addUserToGroup.
	 */
	async addToGroup(userId: string, groupId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		const result = await this.userModel.findOneAndUpdate({ id: userId }, { $addToSet: { groupIds: groupId }, updatedAt: new Date() });
		if (!result) throw new Error(`Usuario ${userId} no encontrado`);
	}

	/**
	 * Remueve un groupId del array groupIds de un usuario.
	 * Usado por GroupManager.removeUserFromGroup.
	 */
	async removeFromGroup(userId: string, groupId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		const result = await this.userModel.findOneAndUpdate({ id: userId }, { $pull: { groupIds: groupId }, updatedAt: new Date() });
		if (!result) throw new Error(`Usuario ${userId} no encontrado`);
	}

	/**
	 * Obtiene todos los usuarios que pertenecen a un grupo.
	 * Usado por GroupManager.getGroupUsers.
	 */
	async getUsersByGroup(groupId: string, token?: string, limit: number = MAX_LIST_LIMIT): Promise<User[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		const docs = await this.userModel.find({ groupIds: groupId }).limit(Math.min(Math.max(limit, 1), MAX_LIST_LIMIT));
		return docs.map((d: any) => d.toObject?.() || d);
	}

	/**
	 * Obtiene las organizaciones de un usuario
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getUserOrganizations(userId: string, token?: string): Promise<string[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS | IdentityScopes.ORGANIZATIONS);

		try {
			const user = await this.userModel.findOne({ id: userId });
			if (!user) return [];
			return user.orgMemberships?.map((m: any) => m.orgId) || [];
		} catch (error) {
			this.logger.logError(`Error obteniendo organizaciones del usuario: ${error}`);
			return [];
		}
	}
}
