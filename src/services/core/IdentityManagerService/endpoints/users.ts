import { RegisterEndpoint, UncommonResponse, type EndpointCtx } from "../../EndpointManagerService/index.js";
import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { AuthError } from "@common/types/custom-errors/AuthError.js";
import { P } from "@common/types/Permissions.ts";
import type IdentityManagerService from "../index.js";
import type { Capability } from "@common/security/Capability.ts";
import * as US from "./schemas/users.js";
import { SuccessResponse, OrgIdQuery } from "./schemas/common.js";
import { assertCanManageUser, assertCanAssignRoles, assertCanGrantPermissions } from "../domain/hierarchy.js";
import { checkUsername } from "@common/utils/name-policy.js";
import { hashEmails, maskEmails } from "@common/utils/identityHash.js";
import { isInternalAddress, normalizeAddress } from "@common/utils/email-address.js";
import type { MailboxRenameResult } from "@common/types/email/Email.js";

/**
 * Matriz de modificabilidad de los campos de usuario:
 *
 * | Campo                       | Quién puede modificarlo                        |
 * | --------------------------- | ---------------------------------------------- |
 * | `id`, `createdAt`           | nadie (inmutables)                             |
 * | `passwordHash`              | nadie; sólo vía `/change-password`             |
 * | `isActive`, `permissions`   | sólo admin global                              |
 * | `username`, `email`         | admin con acceso (PUT), con unicidad; el TITULAR |
 * |                             | vía `/me/change-username` (cooldown 30 días) y   |
 * |                             | `/me/change-email` (confirmación en casilla nueva) |
 * | `roleIds`, `groupIds`       | sólo los del contexto del caller               |
 * | `metadata`                  | libre (datos por aplicación)                   |
 * | `orgMemberships`            | org admin: `roleIds` de su propia membresía;   |
 * |                             | admin global: irrestricto                      |
 */

/**
 * Verifica que el usuario target pertenezca a la org del caller.
 * Admin global (sin orgId) opera sobre usuarios sin restricción de org.
 * Admin de org (con orgId) solo opera sobre usuarios miembros de su org.
 */
async function assertUserOrgAccess(identity: IdentityManagerService, targetUserId: string, callerOrgId?: string, token?: string): Promise<void> {
	if (!callerOrgId) return; // Admin global: sin restricción de membresía
	const user = await identity.users.getUser(targetUserId, token);
	if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
	const isMember = user.orgMemberships?.some((m) => m.orgId === callerOrgId);
	if (!isMember) throw new IdentityError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este usuario");
}

/**
 * Valida que todos los roleIds sean accesibles para el caller.
 * Admin global: acceso irrestricto a cualquier rol.
 * Admin de org: solo roles de su org.
 */
async function validateRoleIdsContext(identity: IdentityManagerService, roleIds: string[], callerOrgId?: string, token?: string): Promise<void> {
	if (!roleIds?.length) return;
	// Global admin: puede asignar cualquier rol
	if (!callerOrgId) return;
	// Org admin: validación restringida
	for (const rid of roleIds) {
		const role = await identity.roles.getRole(rid, token);
		if (!role) throw new IdentityError(400, "INVALID_ROLE", `Rol ${rid} no encontrado`);

		const isOwnOrg = role.orgId === callerOrgId;
		if (!isOwnOrg) {
			throw new IdentityError(403, "CROSS_ORG_ROLE", `No puedes asignar el rol ${role.name} de otro contexto`);
		}
	}
}

/**
 * Valida campos inmutables/sensibles en actualización de usuario:
 * - username: No puede haber duplicados
 * - email: No puede haber duplicados
 * - isActive: Solo admin puede cambiar (requiere acción específica)
 * - groupIds: Valida acceso similar a roleIds
 * - permissions: Solo admin global puede asignar
 */
async function validateImmutableFields(
	identity: IdentityManagerService,
	currentUser: Awaited<ReturnType<IdentityManagerService["users"]["getUser"]>>,
	updates: Partial<any>,
	callerOrgId?: string
): Promise<void> {
	// Username: validar política de nombres y unicidad si se intenta cambiar.
	// Sin esto se esquivaría el filtro registrándose con un nombre limpio y
	// renombrándose después (y con el username cambia su dirección de correo).
	if (updates.username !== undefined && updates.username !== currentUser?.username) {
		if (checkUsername(updates.username)) {
			throw new AuthError(400, "FORBIDDEN_USERNAME", "Ese nombre de usuario no está disponible");
		}
		const existing = await identity.users.getUserByUsername(updates.username);
		if (existing && existing.id !== currentUser?.id) {
			throw new AuthError(409, "USERNAME_EXISTS", `El nombre de usuario '${updates.username}' ya está en uso`);
		}
	}

	// Email: validar unicidad si se intenta cambiar
	if (updates.email !== undefined && updates.email !== currentUser?.email) {
		const existing = await identity.users.getUserByEmail(updates.email);
		if (existing && existing.id !== currentUser?.id) {
			throw new AuthError(409, "EMAIL_EXISTS", `El email '${updates.email}' ya está registrado`);
		}
	}

	// isActive: solo admin puede cambiar estado activo/inactivo
	if (updates.isActive !== undefined && updates.isActive !== currentUser?.isActive) {
		// Org admin no puede cambiar isActive, solo admin global
		if (callerOrgId) {
			throw new IdentityError(403, "FORBIDDEN_FIELD", "Solo administrador global puede cambiar el estado del usuario");
		}
		// Se verifica que sea un booleano válido
		if (typeof updates.isActive !== "boolean") {
			throw new IdentityError(400, "INVALID_FIELD", "isActive debe ser un booleano");
		}
		// Reactivar una cuenta baneada por acá dejaría un estado mitad-desbaneado: metadata de ban
		// intacta y ban-list activa, que sigue bloqueando el login. Sólo el unban levanta ambas.
		if (updates.isActive === true && (currentUser?.metadata as Record<string, unknown> | undefined)?.bannedAt) {
			throw new IdentityError(409, "USER_BANNED", "La cuenta está baneada: reactivala con el flujo de desbaneo (unban), no con isActive");
		}
	}

	// groupIds: validar acceso similar a roleIds
	if (updates.groupIds?.length) {
		for (const gid of updates.groupIds) {
			// Validar que el grupo existe y es accesible
			const group = await identity.groups?.getGroup?.(gid);
			if (!group) {
				throw new IdentityError(400, "INVALID_GROUP", `Grupo ${gid} no encontrado`);
			}
			// Org admin solo puede asignar grupos de su propia org
			if (callerOrgId && group.orgId && group.orgId !== callerOrgId) {
				throw new IdentityError(403, "CROSS_ORG_GROUP", `No puedes asignar el grupo ${group.name} de otro contexto`);
			}
		}
	}

	// permissions: solo admin global puede asignar permisos directos
	if (updates.permissions?.length) {
		if (callerOrgId) {
			throw new IdentityError(403, "FORBIDDEN_FIELD", "Solo administrador global puede asignar permisos directos");
		}
		// Validar estructura de permisos
		for (const perm of updates.permissions) {
			if (!perm.resource || perm.action === undefined || perm.scope === undefined) {
				throw new IdentityError(400, "INVALID_PERMISSION", "Permisos mal formados: requieren resource, action y scope");
			}
		}
	}
}

/**
 * El art. 14 Ley 25.326 exige responder el acceso en 10 días y permite exigirlo gratis cada 6
 * meses; acá es inmediato y 1 por día, pero acotado: la agregación toca todos los servicios.
 */
const EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Mismo formato de email que exige el alta (`validateRegisterBody` de SessionManagerService). */
const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Vigencia (minutos) del enlace de confirmación de cambio de email; espejo del TTL del DAO. */
const EMAIL_CHANGE_TOKEN_TTL_MINUTES = 60;

/**
 * `true` si la cuenta la creó un proveedor OAuth: su password es aleatorio y desconocido, así que
 * no sirve para re-autenticar. El alta nativa estampa `createdVia: "platform"`, el seed `"dev-seed"`.
 */
function isOAuthCreatedAccount(user: { metadata?: Record<string, unknown> }): boolean {
	const via = user.metadata?.createdVia;
	return typeof via === "string" && via !== "platform" && via !== "dev-seed";
}

function getScopedMembership(user: Awaited<ReturnType<IdentityManagerService["users"]["getUser"]>>, callerOrgId?: string) {
	if (!callerOrgId || !user?.orgMemberships?.length) return undefined;
	return user.orgMemberships.find((membership) => membership.orgId === callerOrgId);
}

function getContextRoleIds(user: NonNullable<Awaited<ReturnType<IdentityManagerService["users"]["getUser"]>>>, callerOrgId?: string): string[] {
	if (!callerOrgId) {
		return [...(user.roleIds || []), ...(user.orgMemberships || []).flatMap((membership) => membership.roleIds || [])];
	}

	const scopedMembership = getScopedMembership(user, callerOrgId);
	return [...(user.roleIds || []), ...(scopedMembership?.roleIds || [])];
}

function sanitizeUserForContext(user: NonNullable<Awaited<ReturnType<IdentityManagerService["users"]["getUser"]>>>, callerOrgId?: string) {
	const { passwordHash, ...safeUser } = user;
	if (!callerOrgId) return safeUser;

	return {
		...safeUser,
		orgMemberships: safeUser.orgMemberships?.filter((membership) => membership.orgId === callerOrgId) || [],
	};
}

/**
 * Endpoints HTTP para gestión de usuarios
 * Registrados automáticamente por @EnableEndpoints en IdentityManagerService
 */
export class UserEndpoints {
	private static identity: IdentityManagerService;
	/** Capability del servicio (Identity) para invocar sus superficies gateadas por scope. */
	private static cap: Capability;

	static init(identity: IdentityManagerService, cap: Capability): void {
		UserEndpoints.identity ??= identity;
		UserEndpoints.cap ??= cap;
	}

	@RegisterEndpoint({
		method: "HEAD",
		url: "/api/identity/users/username/:username",
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Comprueba si un username existe",
			description: "Responde 200 si el usuario existe; 404 si no. No expone datos del usuario.",
			schema: { params: US.UsernameParams },
		},
	})
	static async checkUsername(ctx: EndpointCtx<{ username: string }>) {
		const { username } = ctx.params;

		const exists = await UserEndpoints.identity.users.existUserByName(username);

		if (!exists) {
			throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		}

		return {};
	}

	/**
	 * Endpoint público para resolver avatares de un conjunto de usuarios
	 * (e.g. autores de comentarios, miembros listados, etc.). Devuelve únicamente
	 * username + avatar — datos ya públicos donde se muestren.
	 */
	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/avatars",
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Resuelve avatares públicos por IDs",
			description: "Devuelve `username` + `avatar` (datos públicos) para los IDs indicados en `ids` (separados por coma).",
			rateLimit: { max: 60, timeWindow: 60_000 },
			schema: { querystring: US.AvatarsQuery, response: { 200: US.PublicAvatarsResponse } },
		},
	})
	static async getAvatars(ctx: EndpointCtx) {
		const idsParam = (ctx.query?.ids ?? "").toString().trim();
		if (!idsParam) return { profiles: {} };
		const ids = idsParam
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const profiles = await UserEndpoints.identity.users.getPublicProfiles(ids);
		const out: Record<string, { username?: string; avatar: string | null }> = {};
		for (const [id, p] of profiles) out[id] = p;
		return { profiles: out };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users",
		permissions: [P.IDENTITY.USERS.READ],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Lista usuarios",
			description: "Lista usuarios del contexto. El admin global puede filtrar por `orgId`; el admin de org usa su propia organización.",
			schema: { querystring: US.ListUsersQuery, response: { 200: US.UsersListResponse } },
		},
	})
	static async listUsers(ctx: EndpointCtx) {
		// Org admin usa orgId del token; global admin puede filtrar por query param
		const orgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		const limit = Number(ctx.query?.limit) || undefined;
		const offset = Number(ctx.query?.offset) || undefined;
		const rawQ = typeof ctx.query?.q === "string" ? ctx.query.q.trim() : "";
		const q = rawQ.length >= 2 ? rawQ : undefined;
		const { items: users, total } = await UserEndpoints.identity.users.getAllUsers(ctx.token!, orgId, { limit, offset, q });

		// Recoger todos los roleIds referenciados por los usuarios (incluidos orgMemberships)
		const roleIdSet = new Set<string>();
		for (const user of users) {
			for (const roleId of getContextRoleIds(user, orgId)) {
				roleIdSet.add(roleId);
			}
		}

		const roles = await UserEndpoints.identity.roles.getRolesByIds([...roleIdSet], ctx.token!, orgId);

		return {
			users: users.map((user) => sanitizeUserForContext(user, orgId)),
			roles,
			total,
		};
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/search",
		permissions: [P.IDENTITY.USERS.READ],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Busca usuarios",
			description: "Búsqueda por texto (`q`, mín. 2 caracteres). Devuelve hasta 10 resultados.",
			schema: { querystring: US.SearchUsersQuery, response: { 200: US.UsersArrayResponse } },
		},
	})
	static async searchUsers(ctx: EndpointCtx) {
		const q = ctx.query?.q?.trim();
		if (!q || q.length < 2) return [];
		const orgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		const users = await UserEndpoints.identity.users.searchUsers(q, 10, ctx.token!, orgId);

		return users.map((user) => sanitizeUserForContext(user, orgId));
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/me",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Usuario autenticado actual",
			description: "Devuelve el perfil del usuario autenticado (sin `passwordHash`).",
			schema: { response: { 200: US.UserResponse } },
		},
	})
	static async getCurrentUser(ctx: EndpointCtx) {
		if (!ctx.user) {
			throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		}

		const user = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) {
			throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		}

		return sanitizeUserForContext(user, ctx.user.orgId);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/me/preferences",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Preferencias del usuario actual",
			schema: { response: { 200: US.PreferencesResponse } },
		},
	})
	static async getMyPreferences(ctx: EndpointCtx) {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		const user = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		const preferences = (user.metadata?.preferences as Record<string, unknown>) ?? {};
		return { preferences };
	}

	@RegisterEndpoint({
		method: "PATCH",
		url: "/api/identity/users/me/preferences",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Actualiza preferencias del usuario actual",
			description: "Merge superficial de las preferencias enviadas con las existentes.",
			schema: { body: US.PreferencesBody, response: { 200: US.PreferencesResponse } },
		},
	})
	static async patchMyPreferences(ctx: EndpointCtx<Record<string, string>, Record<string, unknown>>) {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		const patch = ctx.data ?? {};
		if (typeof patch !== "object" || Array.isArray(patch)) {
			throw new IdentityError(400, "INVALID_BODY", "El body debe ser un objeto plano");
		}
		const user = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		const currentPrefs = (user.metadata?.preferences as Record<string, unknown>) ?? {};
		const nextPrefs = { ...currentPrefs, ...patch };
		const updated = await UserEndpoints.identity.users.updateOwnMetadata(ctx.user.id, { preferences: nextPrefs }, ctx.token!);
		return { preferences: (updated.metadata?.preferences as Record<string, unknown>) ?? {} };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/:userId",
		permissions: [P.IDENTITY.USERS.READ],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Obtiene un usuario por ID",
			schema: { params: US.UserIdParams, response: { 200: US.UserResponse } },
		},
	})
	static async getUser(ctx: EndpointCtx<{ userId: string }>) {
		const callerOrgId = ctx.user?.orgId;
		await assertUserOrgAccess(UserEndpoints.identity, ctx.params.userId, callerOrgId, ctx.token!);
		const user = await UserEndpoints.identity.users.getUser(ctx.params.userId, ctx.token!);
		if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		return sanitizeUserForContext(user, callerOrgId);
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/change-password",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Cambia la contraseña propia",
			description: "Verifica `currentPassword` y establece `newPassword` (mín. 8 caracteres).",
			rateLimit: { max: 3, timeWindow: 300_000 },
			schema: { body: US.ChangePasswordBody, response: { 200: SuccessResponse } },
		},
	})
	static async changePassword(ctx: EndpointCtx<Record<string, string>, { currentPassword: string; newPassword: string }>) {
		if (!ctx.user) {
			throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		}

		const { currentPassword, newPassword } = ctx.data || {};

		if (!currentPassword || !newPassword) {
			throw new IdentityError(400, "MISSING_FIELDS", "Faltan campos");
		}

		if (newPassword.length < 8) {
			throw new AuthError(400, "WEAK_PASSWORD", "La nueva contraseña debe tener al menos 8 caracteres");
		}

		const user = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) {
			throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		}

		// Primitiva pre-auth: vía la superficie privilegiada `_internal(kernelKey)`,
		// no por el getter público `users` (que ya no la expone).
		const isValid = await UserEndpoints.identity
			._internal(UserEndpoints.cap)
			.users.verifyUserPassword(user.id, currentPassword);

		if (!isValid) {
			throw new AuthError(401, "INVALID_PASSWORD", "Contraseña actual incorrecta");
		}

		await UserEndpoints.identity.users.updatePassword(user.id, newPassword, ctx.token!);
		// Aviso de seguridad (fire-and-forget).
		void UserEndpoints.identity.notifications(UserEndpoints.cap).passwordChanged(user.id);

		return { success: true };
	}

	// ────────────────────────────────────────────────────────────────────────
	// Rectificación self-service (art. 16 Ley 25.326 — 5 días hábiles —, art. 16 RGPD)
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Re-autenticación para cambiar email/username propios.
	 *
	 * - Cuenta con password propio: exige y verifica `currentPassword`.
	 * - Cuenta creada por OAuth: su password es desconocido y la plataforma no tiene primitiva de
	 *   "sesión reciente" que sirva de re-login (el access token se re-emite cada ~15 min, la
	 *   rotación del refresh resetea su `createdAt`, y `lastLogin` sólo lo estampa el login
	 *   nativo). Elección documentada: alcanza la sesión viva y la titularidad la cierra el lazo de
	 *   confirmación (token corto a la casilla nueva + alerta a la vieja). Si igual manda
	 *   `currentPassword`, se verifica.
	 */
	static async #assertSelfReauth(user: { id: string; metadata?: Record<string, unknown> }, currentPassword?: string): Promise<void> {
		if (!currentPassword) {
			if (isOAuthCreatedAccount(user)) return;
			throw new IdentityError(400, "MISSING_FIELDS", "currentPassword es requerido");
		}
		const isValid = await UserEndpoints.identity._internal(UserEndpoints.cap).users.verifyUserPassword(user.id, currentPassword);
		if (!isValid) throw new AuthError(401, "INVALID_PASSWORD", "Contraseña actual incorrecta");
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/me/change-email",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Solicita el cambio del email propio",
			description:
				"Verifica `currentPassword` (u OAuth: sesión viva) y envía un enlace de confirmación de un solo uso, " +
				"válido 60 minutos, a la casilla NUEVA. El cambio se aplica recién al confirmar. " +
				"La casilla vieja recibe en el acto el aviso de seguridad `security.email_change_requested`.",
			rateLimit: { max: 3, timeWindow: 300_000 },
			schema: { body: US.ChangeEmailBody, response: { 200: US.ChangeEmailResponse } },
		},
	})
	static async changeEmail(ctx: EndpointCtx<Record<string, string>, { newEmail: string; currentPassword?: string }>) {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		const newEmail = ctx.data?.newEmail?.trim();
		if (!newEmail) throw new IdentityError(400, "MISSING_FIELDS", "newEmail es requerido");
		if (!EMAIL_REGEX.test(newEmail)) throw new AuthError(400, "INVALID_EMAIL", "El email no es válido");

		const user = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		if (user.email === newEmail) throw new IdentityError(400, "INVALID_FIELD", "La cuenta ya usa esa dirección");

		await UserEndpoints.#assertSelfReauth(user, ctx.data?.currentPassword);

		// Unicidad vía superficie interna: el titular no tiene READ sobre usuarios. Mismo
		// nivel de revelación que el alta (EMAIL_EXISTS ya existe en /auth/register).
		const existing = await UserEndpoints.identity._internal(UserEndpoints.cap).users.getUserByEmail(newEmail);
		if (existing && existing.id !== user.id) {
			throw new AuthError(409, "EMAIL_EXISTS", "Ese email ya está registrado en otra cuenta");
		}

		// Fail-closed ANTES de asentar el pedido: sin transporte, el enlace no llega y el pedido es
		// inservible.
		const sender = UserEndpoints.identity.getSystemEmailSender();
		if (!sender) {
			throw new IdentityError(503, "EMAIL_DELIVERY_UNAVAILABLE", "El envío de correos no está disponible: probá de nuevo más tarde");
		}

		// Con el envío externo deshabilitado una casilla de fuera NO se puede verificar: el correo
		// se puentearía al buzón de plataforma de quien lo pide, así que el enlace volvería a sus
		// propias manos y "confirmar" no probaría nada. Mejor rechazar que simular.
		const policy = sender.getDeliveryPolicy?.();
		if (policy?.internalOnly && !isInternalAddress(newEmail, policy.rootDomain)) {
			throw new IdentityError(
				503,
				"EXTERNAL_EMAIL_UNAVAILABLE",
				`Todavía no podemos verificar direcciones externas: por ahora el email de la cuenta sólo puede ser una dirección @${policy.rootDomain}`,
				{ rootDomain: policy.rootDomain }
			);
		}

		const { confirmToken } = await UserEndpoints.identity.users.requestEmailChange(ctx.user.id, newEmail, ctx.token!);
		const confirmUrl = UserEndpoints.identity.buildEmailChangeConfirmUrl(confirmToken);
		try {
			// Directo al EmailService: la casilla NUEVA todavía no es la de la cuenta y el pipeline
			// de notificaciones sólo entrega a la registrada. `exact` porque el enlace tiene que
			// aterrizar en ESA casilla o no salir; `userId` va sólo para rate-limit y trazas.
			await sender.sendSystemEmail({
				to: newEmail,
				userId: ctx.user.id,
				deliveryGuarantee: "exact",
				subject: "Confirmá tu nuevo email — Confirm your new email",
				html:
					`<p>Pediste usar esta casilla como email de tu cuenta de ADC Platform.</p>` +
					`<p><a href="${confirmUrl}">Confirmar el cambio de email</a> (enlace de un solo uso, vence en ${EMAIL_CHANGE_TOKEN_TTL_MINUTES} minutos).</p>` +
					`<p>Si no fuiste vos, ignorá este correo: sin esta confirmación el email de la cuenta no cambia.</p>` +
					`<hr><p>You asked to use this address as your ADC Platform account email. ` +
					`<a href="${confirmUrl}">Confirm the email change</a> (single-use link, expires in ${EMAIL_CHANGE_TOKEN_TTL_MINUTES} minutes). ` +
					`If this wasn't you, ignore this message: without confirmation the account email does not change.</p>`,
				text:
					`Pediste usar esta casilla como email de tu cuenta de ADC Platform. ` +
					`Confirmá el cambio (enlace de un solo uso, vence en ${EMAIL_CHANGE_TOKEN_TTL_MINUTES} minutos): ${confirmUrl} — ` +
					`Si no fuiste vos, ignorá este correo. / You asked to change your ADC Platform account email. ` +
					`Confirm here (single-use, expires in ${EMAIL_CHANGE_TOKEN_TTL_MINUTES} minutes): ${confirmUrl}`,
			});
		} catch {
			// El pedido queda asentado pero sin enlace entregado: repetirlo emite un token
			// nuevo que pisa a éste, así que no hay estado colgado que limpiar.
			throw new IdentityError(503, "EMAIL_DELIVERY_UNAVAILABLE", "No se pudo enviar el correo de confirmación: probá de nuevo más tarde");
		}

		// Aviso a la casilla VIEJA (todavía es la registrada: el cambio no se aplicó).
		void UserEndpoints.identity
			.notifications(UserEndpoints.cap)
			.emailChangeRequested(ctx.user.id, { maskedNewEmail: maskEmails([newEmail])[0] ?? "***" });
		// Best-effort: la rectificación es un derecho del titular; una auditoría caída no la bloquea.
		void UserEndpoints.identity.getAuditWriter()?.record(UserEndpoints.cap, {
			action: "identity.email-change-requested",
			actorUserId: ctx.user.id,
			targetUserId: ctx.user.id,
			targetResource: "identity:user",
			context: { expiresInMinutes: EMAIL_CHANGE_TOKEN_TTL_MINUTES },
		});

		return { success: true, expiresInMinutes: EMAIL_CHANGE_TOKEN_TTL_MINUTES };
	}

	/**
	 * Canje PÚBLICO del token de confirmación. Sin auth a propósito: quien abre la casilla nueva
	 * puede no tener sesión en ese navegador, y el token ya prueba lo único que falta —el control
	 * de esa casilla—; la autoría del pedido se probó al emitirlo. Lo llama `/confirm-email` de
	 * adc-auth.
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/confirm-email-change",
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Confirma un cambio de email con el token del correo",
			description: "Recibe `{ token }` (enlace enviado a la casilla nueva) y, si es válido, aplica el cambio. Un solo uso.",
			rateLimit: { max: 5, timeWindow: 60_000 },
			schema: { body: US.EmailChangeTokenBody, response: { 200: SuccessResponse } },
		},
	})
	static async confirmEmailChange(ctx: EndpointCtx<Record<string, string>, { token: string }>) {
		const raw = ctx.data?.token?.trim();
		if (!raw) throw new IdentityError(400, "INVALID_EMAIL_CHANGE_TOKEN", "El enlace de confirmación no es válido, ya se usó o venció");
		// Superficie interna (sin token de sesión): mismo patrón que `cancelSelfDeletionByToken`.
		const { user, previousEmail } = await UserEndpoints.identity._internal(UserEndpoints.cap).users.confirmEmailChangeByToken(raw);
		UserEndpoints.identity.permissions.invalidateUser(user.id);
		// Este aviso ya entrega en la casilla NUEVA; la vieja recibió su alerta al pedir el cambio.
		void UserEndpoints.identity.notifications(UserEndpoints.cap).emailChanged(user.id);
		// De la dirección anterior sólo quedan hash y máscara: no hay historial de casillas (sería
		// acumular datos de contacto en desuso) y el audit log no admite emails en claro. El hash
		// es el mismo que compara la ban-list, así que una evasión sigue siendo detectable.
		void UserEndpoints.identity.getAuditWriter()?.record(UserEndpoints.cap, {
			action: "identity.email-changed",
			actorUserId: user.id,
			targetUserId: user.id,
			targetResource: "identity:user",
			context: {
				via: "token",
				previousEmailHash: hashEmails([previousEmail])[0] ?? null,
				previousEmailMask: maskEmails([previousEmail])[0] ?? null,
			},
		});
		return { success: true };
	}

	/**
	 * Cambio de username self-service (ver el `description` para el contrato HTTP).
	 *
	 * El renombrado de buzones que arrastra no es cosmético: con la casilla en el nombre viejo, la
	 * dirección desde la que sale un correo deja de corresponder a ninguna identidad vigente y,
	 * cuando otra persona tome el username liberado, dos titulares quedan asociados a la misma
	 * dirección. De ahí el pre-flight que aborta ANTES de tocar la identidad.
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/me/change-username",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Cambia el nombre de usuario propio",
			description:
				"Verifica `currentPassword` (u OAuth: sesión viva), aplica las validaciones del alta (política de nombres, " +
				"unicidad) y un cooldown de 30 días entre cambios (429 `USERNAME_CHANGE_COOLDOWN` con `Retry-After`). " +
				"Renombra también las direcciones de correo del titular, que se derivan del username; si alguna está " +
				"ocupada, el cambio se rechaza (409 `MAILBOX_ADDRESS_TAKEN`) en vez de dejar identidad y buzón divergidos.",
			rateLimit: { max: 3, timeWindow: 300_000 },
			schema: { body: US.ChangeUsernameBody, response: { 200: US.ChangeUsernameResponse } },
		},
	})
	static async changeUsername(ctx: EndpointCtx<Record<string, string>, { newUsername: string; currentPassword?: string }>) {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		const newUsername = ctx.data?.newUsername?.trim();
		if (!newUsername) throw new IdentityError(400, "MISSING_FIELDS", "newUsername es requerido");
		if (newUsername.length < 3 || newUsername.length > 30) {
			throw new AuthError(400, "INVALID_USERNAME", "El nombre de usuario debe tener entre 3 y 30 caracteres");
		}
		// Mismas reglas del alta: sin esto se esquiva el filtro registrándose con un nombre limpio y
		// renombrándose después. El formato se distingue porque es accionable.
		const rejection = checkUsername(newUsername);
		if (rejection?.reason === "format") {
			throw new AuthError(400, "INVALID_USERNAME", "El nombre de usuario sólo admite letras, números, punto, guion y guion bajo");
		}
		if (rejection) {
			throw new AuthError(400, "FORBIDDEN_USERNAME", "Ese nombre de usuario no está disponible");
		}

		const user = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		if (user.username === newUsername) throw new IdentityError(400, "INVALID_FIELD", "La cuenta ya usa ese nombre de usuario");

		await UserEndpoints.#assertSelfReauth(user, ctx.data?.currentPassword);

		// Feedback rápido; la carrera real la corta el índice único en el DAO (11000 → 409).
		if (await UserEndpoints.identity.users.existUserByName(newUsername)) {
			throw new AuthError(409, "USERNAME_EXISTS", `El nombre de usuario '${newUsername}' ya está en uso`);
		}

		// Pre-flight del buzón ANTES de mutar la identidad: la dirección destino puede
		// estar ocupada aunque el username esté libre (buzón huérfano de una cuenta ya
		// purgada). Abortar acá es mejor que dejar el username nuevo con la casilla vieja.
		const renamer = UserEndpoints.identity.getMailboxRenamer();
		if (renamer) {
			const preview = await renamer.renameUserMailboxes(UserEndpoints.cap, ctx.user.id, newUsername, { dryRun: true });
			if (preview.conflicts.length > 0) {
				throw new IdentityError(409, "MAILBOX_ADDRESS_TAKEN", "La dirección de correo que corresponde a ese nombre de usuario ya está ocupada");
			}
		}

		const updated = await UserEndpoints.identity.users.changeOwnUsername(ctx.user.id, newUsername, ctx.token!);
		UserEndpoints.identity.permissions.invalidateUser(ctx.user.id);

		// Renombre real. Un fallo no revierte el username: la rectificación ya es efectiva y el
		// buzón viejo sigue siendo del mismo titular, así que el estado es consistente aunque
		// desprolijo. Lo que no puede ser es invisible — va al rastro como `mailboxRenamed`.
		let mailboxRenamed: boolean | null = null;
		let emailRealigned = false;
		if (renamer) {
			try {
				const result = await renamer.renameUserMailboxes(UserEndpoints.cap, ctx.user.id, newUsername);
				mailboxRenamed = result.conflicts.length === 0;
				emailRealigned = await UserEndpoints.#realignAccountEmail(ctx.user.id, user.email, result);
			} catch {
				mailboxRenamed = false;
			}
		}

		void UserEndpoints.identity.notifications(UserEndpoints.cap).usernameChanged(ctx.user.id, { mailboxRenamed: mailboxRenamed === true });
		// `previousUsername` es lo que permite atribuir una acción vieja (un correo, un mensaje
		// firmado con ese nombre) a esta cuenta. Es un identificador, no datos de contacto, así que
		// sí entra en el contexto del audit log.
		void UserEndpoints.identity.getAuditWriter()?.record(UserEndpoints.cap, {
			action: "identity.username-changed",
			actorUserId: ctx.user.id,
			targetUserId: ctx.user.id,
			targetResource: "identity:user",
			context: { cooldownDays: 30, previousUsername: user.username, newUsername, mailboxRenamed, emailRealigned },
		});
		return { success: true, username: updated.username };
	}

	/**
	 * Rastro del cambio ADMINISTRATIVO de email o username (`PUT /users/:id`), contracara del canal
	 * manual de la política de privacidad. Sin esto, el único cambio de identidad sin registrar
	 * sería justo el que hace un tercero sobre datos ajenos. Best-effort como el resto de la
	 * rectificación; el email anterior va como hash + máscara.
	 */
	static #auditAdminIdentityEdit(
		actorUserId: string,
		targetUserId: string,
		before: { email?: string; username: string },
		after: { email?: string; username: string }
	): void {
		const audit = UserEndpoints.identity.getAuditWriter();
		if (!audit) return;

		if (after.email !== before.email) {
			void audit.record(UserEndpoints.cap, {
				action: "identity.email-changed",
				actorUserId,
				targetUserId,
				targetResource: "identity:user",
				context: {
					via: "admin",
					previousEmailHash: hashEmails([before.email])[0] ?? null,
					previousEmailMask: maskEmails([before.email])[0] ?? null,
				},
			});
		}
		if (after.username !== before.username) {
			void audit.record(UserEndpoints.cap, {
				action: "identity.username-changed",
				actorUserId,
				targetUserId,
				targetResource: "identity:user",
				context: { via: "admin", previousUsername: before.username, newUsername: after.username },
			});
		}
	}

	/**
	 * Realinea el email de la cuenta cuando ERA la casilla de plataforma recién renombrada: esa
	 * dirección ya no existe y dejarla apuntaría el canal de contacto al vacío. No pasa por el lazo
	 * de confirmación —ahí se prueba el control de una casilla ajena, y acá es el mismo buzón del
	 * mismo titular con otro nombre—. Devuelve si hubo realineación, que va al rastro.
	 */
	static async #realignAccountEmail(userId: string, currentEmail: string | undefined, result: MailboxRenameResult): Promise<boolean> {
		if (!currentEmail) return false;
		const moved = result.renamed.find((r) => normalizeAddress(r.from) === normalizeAddress(currentEmail));
		if (!moved) return false;
		await UserEndpoints.identity._internal(UserEndpoints.cap).users.updateUser(userId, { email: moved.to });
		return true;
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users",
		permissions: [P.IDENTITY.USERS.WRITE],
		options: {
			successStatus: 201,
			tag: "IdentityManagerService/Users",
			summary: "Crea un usuario",
			description: "El admin de org lo asocia automáticamente a su organización; el admin global puede indicar `orgId`.",
			schema: { body: US.CreateUserBody, response: { 201: US.UserResponse } },
		},
	})
	static async createUser(
		ctx: EndpointCtx<Record<string, string>, { username: string; password: string; roleIds?: string[]; orgId?: string }>
	) {
		if (!ctx.data?.username || !ctx.data?.password) {
			throw new IdentityError(400, "MISSING_FIELDS", "username y password son requeridos");
		}
		// Org admin usa orgId del token; global admin puede especificar en body
		const callerOrgId = ctx.user?.orgId || ctx.data?.orgId;
		// Validar que los roleIds asignados sean del contexto correcto y de jerarquía menor a la del actor
		if (ctx.data.roleIds?.length) {
			await validateRoleIdsContext(UserEndpoints.identity, ctx.data.roleIds, callerOrgId, ctx.token!);
			await assertCanAssignRoles(UserEndpoints.identity.permissions, ctx.user?.id, ctx.data.roleIds, callerOrgId);
		}
		const globalRoleIds = callerOrgId ? [] : ctx.data.roleIds;
		const user = await UserEndpoints.identity.users.createUser(ctx.data.username, ctx.data.password, globalRoleIds, ctx.token!);
		// Si se crea desde modo org, asociar automáticamente a la organización
		if (callerOrgId) {
			await UserEndpoints.identity.users.addOrgMembership(user.id, callerOrgId, ctx.data.roleIds || [], ctx.token!);
		}
		const createdUser = callerOrgId ? await UserEndpoints.identity.users.getUser(user.id, ctx.token!) : user;
		if (!createdUser) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		UserEndpoints.identity.permissions.invalidateUser(createdUser.id);
		return sanitizeUserForContext(createdUser, callerOrgId);
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/identity/users/:userId",
		permissions: [P.IDENTITY.USERS.UPDATE],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Actualiza un usuario",
			description:
				"Campos sensibles (isActive, permissions) restringidos a admin global. `passwordHash`/`id` se ignoran. " +
				"Reactivar una cuenta con baja programada es fail-closed: sin auditoría disponible no se ejecuta.",
			schema: { params: US.UserIdParams, querystring: OrgIdQuery, body: US.UpdateUserBody, response: { 200: US.UserResponse } },
		},
	})
	static async updateUser(
		ctx: EndpointCtx<
			{ userId: string },
			Partial<{
				username: string;
				email: string;
				isActive: boolean;
				roleIds: string[];
				groupIds: string[];
				permissions: { resource: string; action: number; scope: number }[];
			}>
		>
	) {
		const callerOrgId = ctx.user?.orgId || ctx.query?.orgId || undefined;

		await assertUserOrgAccess(UserEndpoints.identity, ctx.params.userId, callerOrgId, ctx.token!);
		// Jerarquía: ni a sí mismo ni a usuarios de jerarquía igual o superior
		await assertCanManageUser(UserEndpoints.identity.permissions, ctx.user?.id, ctx.params.userId, callerOrgId);

		// Obtener usuario actual para validaciones comparativas
		const currentUser = await UserEndpoints.identity.users.getUser(ctx.params.userId, ctx.token!);
		if (!currentUser) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");

		const updates = { ...ctx.data };

		// Validar campos inmutables/sensibles ANTES de cualquier modificación
		await validateImmutableFields(UserEndpoints.identity, currentUser, updates, callerOrgId);

		// Permisos directos: nadie otorga lo que no tiene. `validateImmutableFields` sólo exige
		// contexto global y forma del objeto: sin este guard, cualquier admin global puede
		// escribir un `*` sobre un usuario de jerarquía menor y loguearse con esa cuenta.
		// El contexto es `ctx.user?.orgId`, NO `callerOrgId`: éste absorbe `?orgId=` de la query,
		// y resolver los permisos del actor en una org donde no es miembro daría un 403 espurio.
		await assertCanGrantPermissions(
			UserEndpoints.identity.permissions,
			ctx.user?.id,
			updates.permissions,
			ctx.user?.orgId,
			currentUser.permissions
		);

		// Prevent updating sensitive fields via API
		delete (updates as any).passwordHash;
		delete (updates as any).id;

		// Validar que los roleIds asignados sean del contexto correcto; los roles
		// AGREGADOS deben ser de jerarquía menor a la del actor (quitar roles altos
		// ya lo bloquea assertCanManageUser: el target los porta y outrankea al actor)
		if (updates.roleIds?.length) {
			await validateRoleIdsContext(UserEndpoints.identity, updates.roleIds, callerOrgId, ctx.token!);
			const currentRoleIds = new Set(getContextRoleIds(currentUser, callerOrgId));
			const addedRoleIds = updates.roleIds.filter((rid) => !currentRoleIds.has(rid));
			await assertCanAssignRoles(UserEndpoints.identity.permissions, ctx.user?.id, addedRoleIds, callerOrgId);
		}

		if (callerOrgId) {
			const scopedMembership = getScopedMembership(currentUser, callerOrgId);
			if (!scopedMembership) {
				throw new IdentityError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este usuario");
			}

			// En contexto org: solo permitir actualizar roleIds dentro de la membresía
			const nextMemberships = (currentUser.orgMemberships || []).map((membership) =>
				membership.orgId === callerOrgId ? { ...membership, roleIds: updates.roleIds || membership.roleIds } : membership
			);

			// Remover roleIds y groupIds del objeto updates ya que se manejan via orgMemberships
			const safeUpdates = { ...updates };
			delete (safeUpdates as any).roleIds;
			delete (safeUpdates as any).groupIds;

			const user = await UserEndpoints.identity.users.updateUser(
				ctx.params.userId,
				{ ...safeUpdates, orgMemberships: nextMemberships },
				ctx.token!
			);
			UserEndpoints.identity.permissions.invalidateUser(user.id);
			return sanitizeUserForContext(user, callerOrgId);
		}

		// Una cuenta reactivada no puede seguir en la cola de purga (el cron borraría una cuenta
		// viva). Sacar a un tercero de esa cola es una decisión administrativa sobre SUS datos
		// personales, así que es FAIL-CLOSED respecto de la auditoría: pre-flight ANTES de mutar.
		const isReactivation =
			updates.isActive === true &&
			currentUser.isActive === false &&
			Boolean((currentUser.metadata as Record<string, unknown> | undefined)?.scheduledDeletionAt);
		const audit = isReactivation ? UserEndpoints.identity.getAuditWriter() : null;
		if (isReactivation && !audit?.isWritable()) {
			throw new IdentityError(503, "AUDIT_UNAVAILABLE", "Auditoría no disponible: la reactivación queda bloqueada");
		}

		// Global admin: permitir todas las actualizaciones validadas
		const user = await UserEndpoints.identity.users.updateUser(ctx.params.userId, updates, ctx.token!);
		UserEndpoints.identity.permissions.invalidateUser(user.id);
		UserEndpoints.#auditAdminIdentityEdit(ctx.user!.id, ctx.params.userId, currentUser, user);

		if (isReactivation) {
			const reactivated = await UserEndpoints.identity.users.cancelScheduledDeletion(ctx.params.userId, ctx.token!);
			try {
				await audit!.recordStrict(UserEndpoints.cap, {
					action: "identity.reactivate-user",
					actorUserId: ctx.user!.id,
					targetUserId: ctx.params.userId,
					targetResource: "identity:user",
					context: { clearedScheduledDeletion: true },
				});
			} catch (auditError) {
				// Fail-closed también DESPUÉS de mutar: se restaura el estado previo tal cual estaba
				// —misma baja programada, con su fecha y su token intactos— y el admin reintenta.
				await UserEndpoints.identity.users
					.updateUser(ctx.params.userId, { isActive: false, metadata: currentUser.metadata }, ctx.token!)
					.then(() => UserEndpoints.identity.permissions.invalidateUser(ctx.params.userId))
					.catch(() => {});
				throw auditError;
			}
			return sanitizeUserForContext(reactivated);
		}
		return sanitizeUserForContext(user);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/users/:userId",
		permissions: [P.IDENTITY.USERS.DELETE],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Da de baja un usuario",
			description:
				"En modo org, solo quita la membresía de la organización. El admin global programa la baja (30 días, " +
				"misma cascada de purga que la baja voluntaria); `immediate=true` ejecuta la cascada ya mismo. " +
				"Fail-closed: sin auditoría disponible la baja administrativa no se ejecuta.",
			schema: { params: US.UserIdParams, querystring: US.DeleteUserQuery, response: { 200: SuccessResponse } },
		},
	})
	static async deleteUser(ctx: EndpointCtx<{ userId: string }>) {
		const callerOrgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		await assertUserOrgAccess(UserEndpoints.identity, ctx.params.userId, callerOrgId, ctx.token!);
		// Jerarquía: la baja propia va por DELETE /users/me, no por el endpoint de gestión
		await assertCanManageUser(UserEndpoints.identity.permissions, ctx.user?.id, ctx.params.userId, callerOrgId);
		if (callerOrgId) {
			await UserEndpoints.identity.users.removeOrgMembership(ctx.params.userId, callerOrgId, ctx.token!);
			UserEndpoints.identity.permissions.invalidateUser(ctx.params.userId);
			return { success: true };
		}

		// Baja sobre datos personales de un tercero: FAIL-CLOSED respecto de la auditoría
		// (accountability art. 5.2 RGPD / art. 9 Ley 25.326), con pre-flight antes de mutar.
		const immediate = ctx.query?.immediate === "true";
		const audit = UserEndpoints.identity.getAuditWriter();
		if (!audit?.isWritable()) {
			throw new IdentityError(503, "AUDIT_UNAVAILABLE", "Auditoría no disponible: la baja administrativa queda bloqueada");
		}

		// Nunca un borrado directo: misma baja programada que el flujo voluntario. `immediate` sólo
		// adelanta el vencimiento; la cascada es siempre la del stepper.
		const retentionDays = immediate ? 0 : 30;
		const user = await UserEndpoints.identity.users.scheduleAdminDeletion(ctx.params.userId, retentionDays, ctx.token!);
		UserEndpoints.identity.permissions.invalidateUser(ctx.params.userId);

		try {
			await audit.recordStrict(UserEndpoints.cap, {
				action: "identity.delete-user",
				actorUserId: ctx.user!.id,
				targetUserId: ctx.params.userId,
				targetResource: "identity:user",
				context: { immediate, retentionDays },
			});
		} catch (auditError) {
			// Fail-closed también DESPUÉS de mutar: la baja no puede quedar programada sin rastro
			// (el cron la ejecutaría igual). Revertir es seguro porque todavía no corrió ningún
			// purger; si el rollback también falla, se propaga el error original.
			await UserEndpoints.identity
				._internal(UserEndpoints.cap)
				.users.cancelScheduledDeletion(ctx.params.userId)
				.then(() => UserEndpoints.identity.permissions.invalidateUser(ctx.params.userId))
				.catch(() => {});
			throw auditError;
		}

		void UserEndpoints.identity.notifications(UserEndpoints.cap).securityEvent({
			title: "Baja de usuario programada",
			body: `El usuario ${ctx.params.userId} fue dado de baja por ${ctx.user?.id ?? "desconocido"} (${immediate ? "purga inmediata" : "purga en 30 días"}).`,
			actorId: ctx.user?.id,
			data: { userId: ctx.params.userId, immediate },
		});

		if (immediate) {
			// Cascada ya mismo. No lanza: si un paso falla queda logueado y el cron de 6h
			// retoma desde ese paso (la baja ya está asentada y auditada).
			await UserEndpoints.identity.purgeDueUserNow(ctx.params.userId);
		} else {
			const scheduledFor = (user.metadata as Record<string, unknown> | undefined)?.scheduledDeletionAt as Date | undefined;
			void UserEndpoints.identity
				.notifications(UserEndpoints.cap)
				.accountDeletionScheduled(ctx.params.userId, { scheduledFor, cancelUrl: null, byAdmin: true });
		}
		return { success: true };
	}

	// ────────────────────────────────────────────────────────────────────────
	// Self-delete
	// ────────────────────────────────────────────────────────────────────────

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/users/me",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Solicita la baja de la cuenta propia",
			description:
				"Programa el borrado de la cuenta en 30 días. Acepta un `reason` opcional. Durante esos 30 días la baja se " +
				"revierte volviendo a iniciar sesión, o con el enlace de arrepentimiento (token de un solo uso) que se envía " +
				"a la casilla registrada o al buzón de plataforma del titular. Si ese aviso NO se pudo entregar, la baja se " +
				"registra igual (el derecho de supresión no depende del correo) y la respuesta trae `cancelUrl` con " +
				"`noticeDelivered: false` para que el cliente lo muestre en pantalla.",
			schema: { body: US.DeleteSelfBody, response: { 200: US.DeleteSelfResponse } },
		},
	})
	static async deleteSelf(ctx: EndpointCtx<Record<string, string>, { reason?: string }>) {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay sesión");
		const { reason } = ctx.data || {};

		const current = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!current) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");

		// La supresión NUNCA se bloquea por el correo: es una obligación con plazo legal (art. 16
		// Ley 25.326 / art. 17 RGPD) y la ventana de arrepentimiento es política propia. Sin aviso
		// entregado sigue habiendo vuelta: volver a entrar cancela la baja, y el enlace viaja en
		// la respuesta.
		const sender = UserEndpoints.identity.getSystemEmailSender();

		const { user, cancelToken } = await UserEndpoints.identity.users.requestSelfDeletion(ctx.user.id, reason, 30, ctx.token!);
		const scheduledFor = (user.metadata as Record<string, unknown> | undefined)?.scheduledDeletionAt as Date | undefined;
		const cancelUrl = cancelToken ? UserEndpoints.identity.buildCancelDeletionUrl(cancelToken) : null;

		let noticeDelivered = false;
		if (!current.email) {
			// Cuenta sin email: aviso best-effort por los otros canales.
			void UserEndpoints.identity.notifications(UserEndpoints.cap).accountDeletionScheduled(ctx.user.id, { scheduledFor, cancelUrl });
		} else if (sender) {
			const fecha = scheduledFor ? new Date(scheduledFor).toISOString().slice(0, 10) : null;
			const cuando = fecha ? ` el ${fecha}` : " en 30 días";
			const arrepentimientoEs = cancelUrl
				? ` Si te arrepentís, volvé a iniciar sesión o <a href="${cancelUrl}">cancelá la baja</a> antes de esa fecha (enlace de un solo uso).`
				: " Si te arrepentís, volvé a iniciar sesión antes de esa fecha.";
			const arrepentimientoEn = cancelUrl
				? ` If you change your mind, just log back in or <a href="${cancelUrl}">cancel the deletion</a> before that date (single-use link).`
				: " If you change your mind, just log back in before that date.";
			try {
				// Directo y AWAITED (no por notificaciones): hay que saber si el enlace salió para
				// mostrarlo en pantalla si no. `any-mailbox` en vez del default best-effort, que
				// omitía el envío en silencio.
				await sender.sendSystemEmail({
					to: current.email,
					userId: ctx.user.id,
					deliveryGuarantee: "any-mailbox",
					subject: "Tu cuenta va a ser eliminada — Your account is scheduled for deletion",
					html:
						`<p>Registramos tu solicitud de baja de ADC Platform. Tu cuenta quedó desactivada y se eliminará ` +
						`definitivamente${cuando}, junto con tus datos personales.${arrepentimientoEs}</p>` +
						`<hr><p>We registered your ADC Platform account deletion request. Your account is now deactivated and will be ` +
						`permanently deleted${fecha ? ` on ${fecha}` : " in 30 days"}, along with your personal data.${arrepentimientoEn}</p>`,
					text:
						`Registramos tu solicitud de baja. Tu cuenta se eliminará definitivamente${cuando}. ` +
						`Si te arrepentís, volvé a iniciar sesión antes de esa fecha` +
						(cancelUrl ? ` o usá este enlace de un solo uso: ${cancelUrl}` : "") +
						`. / We registered your deletion request; your account will be permanently deleted${fecha ? ` on ${fecha}` : " in 30 days"}. ` +
						`Log back in before that date to keep it` +
						(cancelUrl ? `, or use this single-use link: ${cancelUrl}` : "") +
						`.`,
				});
				noticeDelivered = true;
			} catch {
				// La baja YA está registrada y no se revierte: revertirla sería no cumplir el
				// pedido de supresión. El enlace vuelve en la respuesta.
			}
		}

		// `noticeDelivered` va al rastro: responde un futuro "nunca me avisaron". Best-effort,
		// para no bloquear el ejercicio del derecho.
		void UserEndpoints.identity.getAuditWriter()?.record(UserEndpoints.cap, {
			action: "identity.delete-self",
			actorUserId: ctx.user.id,
			targetUserId: ctx.user.id,
			targetResource: "identity:user",
			context: { retentionDays: 30, noticeDelivered, hasEmail: Boolean(current.email) },
		});

		return {
			success: true,
			scheduledDeletionInDays: 30,
			noticeDelivered,
			// Sólo si el aviso no llegó (ver el schema). Sin riesgo: el token únicamente CANCELA
			// la baja y lo recibe quien acaba de autenticarse como titular.
			cancelUrl: noticeDelivered ? null : cancelUrl,
		};
	}

	/**
	 * Camino de arrepentimiento con sesión aún viva. Sólo la baja VOLUNTARIA
	 * (`deletionReason: "self"`) es cancelable por la persona; "admin" y "ban" no.
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/me/cancel-deletion",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Cancela la baja voluntaria propia",
			description: "Limpia la baja programada y reactiva la cuenta. Sólo aplica a bajas voluntarias pendientes.",
			rateLimit: { max: 5, timeWindow: 300_000 },
			schema: { response: { 200: SuccessResponse } },
		},
	})
	static async cancelOwnDeletion(ctx: EndpointCtx) {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay sesión");
		const current = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!current) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		const meta = (current.metadata ?? {}) as Record<string, unknown>;
		if (!meta.scheduledDeletionAt || meta.deletionReason !== "self") {
			throw new IdentityError(409, "NOT_CANCELLABLE", "No hay una baja voluntaria pendiente de cancelar");
		}
		await UserEndpoints.identity.users.cancelScheduledDeletion(ctx.user.id, ctx.token!);
		UserEndpoints.identity.permissions.invalidateUser(ctx.user.id);
		void UserEndpoints.identity.notifications(UserEndpoints.cap).accountDeletionCancelled(ctx.user.id);
		// Best-effort: cancelar es a favor de la persona; una auditoría caída no debe impedirlo.
		void UserEndpoints.identity.getAuditWriter()?.record(UserEndpoints.cap, {
			action: "identity.cancel-deletion",
			actorUserId: ctx.user.id,
			targetUserId: ctx.user.id,
			targetResource: "identity:user",
			context: { via: "session" },
		});
		return { success: true };
	}

	/**
	 * Canje PÚBLICO del token de arrepentimiento (la baja voluntaria revoca las
	 * sesiones, así que este flujo no puede exigir auth). La página que lo llama es
	 * `/cancel-deletion?token=…` de adc-auth. Toda la validación (HMAC, vigencia,
	 * un solo uso, `deletionReason: "self"`) vive en el DAO.
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/cancel-deletion",
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Cancela una baja voluntaria con el token del email",
			description: "Recibe `{ token }` (enlace de arrepentimiento) y, si es válido, reactiva la cuenta. Un solo uso.",
			rateLimit: { max: 5, timeWindow: 60_000 },
			schema: { body: US.CancelDeletionTokenBody, response: { 200: SuccessResponse } },
		},
	})
	static async cancelDeletionByToken(ctx: EndpointCtx<Record<string, string>, { token: string }>) {
		const raw = ctx.data?.token?.trim();
		if (!raw) throw new IdentityError(400, "INVALID_CANCEL_TOKEN", "El enlace de cancelación no es válido, ya se usó o venció");
		// Superficie interna (sin token de sesión): mismo patrón que `verifyUserPassword`.
		const user = await UserEndpoints.identity._internal(UserEndpoints.cap).users.cancelSelfDeletionByToken(raw);
		UserEndpoints.identity.permissions.invalidateUser(user.id);
		void UserEndpoints.identity.notifications(UserEndpoints.cap).accountDeletionCancelled(user.id);
		void UserEndpoints.identity.getAuditWriter()?.record(UserEndpoints.cap, {
			action: "identity.cancel-deletion",
			actorUserId: user.id,
			targetUserId: user.id,
			targetResource: "identity:user",
			context: { via: "token" },
		});
		return { success: true };
	}

	// ────────────────────────────────────────────────────────────────────────
	// Export de datos personales (portabilidad)
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Derecho de acceso/portabilidad (art. 14 Ley 25.326, arts. 15 y 20 RGPD). Síncrono a
	 * propósito: cada sección está acotada por topes propios, así que no hace falta el pipeline de
	 * jobs — y el enqueue está prohibido para endpoints autenticados (no corre auth en el borde).
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/me/export",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Exporta los datos personales de la cuenta propia",
			description:
				"Agrega los datos de la cuenta en todos los servicios (identidad, sesiones activas, drive, correo, tickets, " +
				"notificaciones, suscripción, comunidad) y responde `application/json` descargable (`Content-Disposition: attachment`), " +
				"con una sección por servicio y metadatos (fecha, versión de formato). No incluye binarios ni secretos. " +
				"Límite duro: 1 export cada 24 h por usuario (429 `EXPORT_RATE_LIMITED` con `Retry-After`).",
			rateLimit: { max: 3, timeWindow: 300_000 },
		},
	})
	static async exportMyData(ctx: EndpointCtx) {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		const user = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");

		const rawLast = (user.metadata as Record<string, unknown> | undefined)?.lastExportAt;
		const lastMs = typeof rawLast === "string" || rawLast instanceof Date ? new Date(rawLast).getTime() : 0;
		const elapsed = Date.now() - lastMs;
		if (lastMs > 0 && elapsed < EXPORT_COOLDOWN_MS) {
			const retryAfterSeconds = Math.ceil((EXPORT_COOLDOWN_MS - elapsed) / 1000);
			throw new IdentityError(429, "EXPORT_RATE_LIMITED", "Ya generaste un export de tus datos en las últimas 24 horas", {
				retryAfterSeconds,
			});
		}

		const doc = await UserEndpoints.identity.buildUserDataExport(ctx.user.id);
		// El cooldown se asienta con el export ya armado: un fallo a mitad de la agregación no puede
		// dejar el derecho de acceso bloqueado 24 h.
		await UserEndpoints.identity.users.updateOwnMetadata(ctx.user.id, { lastExportAt: new Date().toISOString() }, ctx.token!);

		// Best-effort: el export no muta datos de terceros, así que una auditoría caída no debe
		// impedir el ejercicio del derecho.
		const sectionsOk = Object.entries(doc.sections)
			.filter(([, section]) => section.available)
			.map(([name]) => name)
			.join(",");
		void UserEndpoints.identity.getAuditWriter()?.record(UserEndpoints.cap, {
			action: "identity.data-export",
			actorUserId: ctx.user.id,
			targetUserId: ctx.user.id,
			targetResource: "identity:user",
			context: { sections: sectionsOk },
		});

		const stamp = new Date().toISOString().slice(0, 10);
		throw UncommonResponse.json(doc, {
			headers: { "Content-Disposition": `attachment; filename="adc-data-export-${stamp}.json"` },
		});
	}

	// ────────────────────────────────────────────────────────────────────────
	// Bug bounty — upgrade temporal de tier (recompensa)
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Otorga un upgrade temporal de tier a un usuario (recompensa de bug bounty).
	 * Solo admin/Security Manager (permiso UPDATE sobre usuarios). El cron de
	 * IdentityManagerService revierte el grant al expirar.
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/:userId/tier-grant",
		permissions: [P.IDENTITY.USERS.UPDATE],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Otorga un upgrade temporal de tier (bug bounty)",
			description: "Setea un tier de pago (plus/pro) por N días; un cron lo revierte al expirar. Solo admin/Security Manager.",
			schema: { params: US.UserIdParams, body: US.TierGrantBody, response: { 200: US.TierGrantResponse } },
		},
	})
	static async grantTier(ctx: EndpointCtx<{ userId: string }, { tier: "pro" | "plus"; days: number; reason?: string }>) {
		const { tier, days, reason } = ctx.data || ({} as { tier: "pro" | "plus"; days: number; reason?: string });
		await assertCanManageUser(UserEndpoints.identity.permissions, ctx.user?.id, ctx.params.userId, ctx.user?.orgId);
		const grant = await UserEndpoints.identity.users.grantTemporaryTier(ctx.params.userId, tier, days, reason, ctx.token!);
		UserEndpoints.identity.permissions.invalidateUser(ctx.params.userId);
		return grant;
	}
}
