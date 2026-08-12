import type { Model } from "mongoose";
import { BaseService } from "../../BaseService.js";
import type MongoProvider from "../../../providers/object/mongo/index.js";
import type RedisProvider from "../../../providers/queue/redis/index.js";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";
import type { Kernel } from "../../../kernel.js";
import type { BanRecord, BanInput, BanLookupResult } from "@common/types/identity/Moderation.js";
import type { User } from "@common/types/identity/User.js";
import { Scope, assertScope, type CapabilityToken } from "@common/security/Capability.ts";
import type { IModerationService } from "@common/types/identity/IModerationService.ts";
import type { IOperationsService } from "@common/types/operations/IOperationsService.ts";

import { assertCanManageUser } from "../../core/IdentityManagerService/domain/hierarchy.js";
import { ModerationError } from "@common/types/custom-errors/ModerationError.ts";
import { buildBanSchema, DEFAULT_BAN_RETENTION_DAYS } from "./domain/ban.js";
import { BanRepository } from "./dao/BanRepository.js";
import { DiscordSyncRunner } from "./sync/DiscordSyncRunner.js";
import { EnableEndpoints, DisableEndpoints } from "../../core/EndpointManagerService/index.js";
import { BanEndpoints } from "./endpoints/bans.js";

interface ModerationPrivateConfig {
	discord?: { syncEnabled?: boolean | string; syncIntervalMs?: number };
	retention?: { banRetentionDays?: number | string };
}

/** Cada cuánto se buscan bans temporales vencidos para desactivarlos (y minimizarlos). */
const EXPIRED_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface ModerationInternalApi {
	// Hot-path lookups (login flow, sin auth)
	isEmailBanned(rawEmail: string): Promise<BanLookupResult>;
	isIpBanned(rawIp: string): Promise<BanLookupResult>;
	recordLoginAttemptIp(userId: string, rawIp: string): Promise<void>;
	// Mutaciones internas sin auth (retention purge, sync runner)
	banPlatformUser(
		user: Pick<User, "id" | "email" | "linkedAccounts" | "lastLogin">,
		args: { reason: string; expiresAt?: Date | null; source?: BanInput["source"]; externalId?: string }
	): Promise<BanRecord>;
	unbanByUserIdInternal(userId: string, reason?: string): Promise<number>;
	// Mutaciones admin (auth via token + PermissionChecker en repo)
	addRawBan(input: BanInput, token: string): Promise<BanRecord>;
	banUserById(userId: string, args: { reason: string; expiresAt?: Date | null }, token: string): Promise<BanRecord>;
	unbanUserById(userId: string, reason: string | undefined, token: string): Promise<number>;
	unbanByExternalId(source: string, externalId: string, reason: string | undefined, token: string): Promise<number>;
	listBans(opts: { activeOnly?: boolean; limit?: number; offset?: number; q?: string }, token: string): Promise<{ items: BanRecord[]; total: number }>;
	/** Guard de jerarquía: el actor no puede moderarse a sí mismo ni a usuarios de jerarquía ≥. */
	assertCanModerate(actorId: string | undefined, targetUserId: string): Promise<void>;
}

/**
 * ModerationService — Lista anti-evasión por hash (email + IP) + sync con Discord.
 *
 * Superficie pública: solo `start`/`stop`/`name`. Toda la lógica (lookups hot-path,
 * mutaciones internas y operaciones admin) se expone únicamente vía `_internal(kernelKey)`.
 */
export default class ModerationService extends BaseService implements IModerationService {
	public readonly name = "ModerationService";

	readonly #mongoProvider: MongoProvider;
	#repo: BanRepository | null = null;
	#authedRepo: BanRepository | null = null;
	#identityService: IIdentityManagerService | null = null;
	#sync: DiscordSyncRunner | null = null;
	#expiredSweep: ReturnType<typeof setInterval> | null = null;

	constructor(kernel: Kernel, options?: any) {
		super(kernel, options);
		this.#mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
	}

	@EnableEndpoints({ managers: () => [BanEndpoints] })
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		await this.#waitConnected(this.#mongoProvider);

		const BanModel = this.#mongoProvider.createModel<BanRecord>("Ban", buildBanSchema(this.#retentionSeconds()));
		await this.#ensureIndexes(BanModel);
		const redis = this.#tryGet<RedisProvider>("provider", "queue/redis");
		if (!redis) this.logger.logWarn("[ModerationService] Redis no disponible. Lookups serán Mongo-only.");

		this.#repo = new BanRepository(BanModel, redis, this.logger);
		await this.#repo.warmupRedisCache();
		await this.#minimizeInactive();

		this.#identityService = this.#tryGet<IIdentityManagerService>("service", "IdentityManagerService");
		this.#authedRepo = this.#identityService
			? new BanRepository(BanModel, redis, this.logger, () => this.#identityService!.createAuthVerifier())
			: this.#repo;

		// Después de resolver Identity: la primera pasada también reactiva cuentas (igual tolera
		// que no esté, porque es una dependencia opcional del despliegue).
		this.#startExpiredSweep();

		const pengubot = this.#tryGet<MongoProvider>("provider", "pengubot@object/mongo");
		if (pengubot && this.#identityService) {
			this.#sync = new DiscordSyncRunner(
				this.#repo,
				(u, a) => this.#banPlatformUser(u, a),
				this.#identityService,
				this.getCapability(),
				this.logger,
				(fn) => this.#onlyOnLeader("moderation.discord-sync", 7200, fn)
			);
			const cfg = (this.config?.private as ModerationPrivateConfig | undefined)?.discord;
			await this.#sync.start(pengubot, { enabled: cfg?.syncEnabled, intervalMs: cfg?.syncIntervalMs });
		}

		BanEndpoints.init(this, this.getCapability());
		this.logger.logOk(`${this.name} iniciado`);
	}

	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		await this.#sync?.stop();
		this.#sync = null;
		if (this.#expiredSweep) {
			clearInterval(this.#expiredSweep);
			this.#expiredSweep = null;
		}
	}

	/**
	 * Acceso privilegiado para servicios de infraestructura (kernel-only).
	 * Cualquier consumidor externo debe pasar el `kernelKey` recibido en su propio `start()`.
	 */
	_internal(token: CapabilityToken): ModerationInternalApi {
		assertScope(token, Scope.ModerationInternal);
		const repo = this.#requireRepo();
		const authed = this.#authedRepo ?? repo;
		return {
			isEmailBanned: (email) => repo.isEmailBanned(email),
			isIpBanned: (ip) => repo.isIpBanned(ip),
			recordLoginAttemptIp: (userId, ip) => repo.recordLoginIp(userId, ip),
			banPlatformUser: (user, args) => this.#banPlatformUser(user, args),
			unbanByUserIdInternal: (userId, reason) => repo.deactivateBans({ userId }, reason),
			addRawBan: (input, token) => authed.addBan(input, token),
			banUserById: (userId, args, token) => this.#banUserById(userId, args, token),
			unbanUserById: (userId, reason, token) => this.#unbanUserById(userId, reason, token),
			unbanByExternalId: (source, externalId, reason, token) => authed.deactivateBans({ source, externalId }, reason, token),
			listBans: (opts, token) => authed.listBans(opts, token),
			assertCanModerate: (actorId, targetUserId) => this.#assertCanModerate(actorId, targetUserId),
		};
	}

	/** Jerarquía de roles: moderar es gestionar — ni a sí mismo ni a jerarquía igual o superior. */
	async #assertCanModerate(actorId: string | undefined, targetUserId: string): Promise<void> {
		if (!this.#identityService) throw new Error("IdentityManagerService no disponible");
		await assertCanManageUser(this.#identityService.permissions, actorId, targetUserId);
	}

	/** Alerta `security.alert` al equipo (Admins + Security Managers globales), best-effort. */
	#notifySecurity(event: { title: string; body: string; data?: Record<string, unknown> }): void {
		try {
			void this.#identityService?.notifications(this.getCapability()).securityEvent(event);
		} catch (err: any) {
			this.logger.logDebug(`Alerta de seguridad no emitida: ${err?.message || err}`);
		}
	}

	// ─── Privados ─────────────────────────────────────────────────────────────

	#requireRepo(): BanRepository {
		if (!this.#repo) throw new Error("ModerationService no inicializado");
		return this.#repo;
	}

	#retentionSeconds(): number {
		const days = Number((this.config?.private as ModerationPrivateConfig | undefined)?.retention?.banRetentionDays);
		return (Number.isFinite(days) && days > 0 ? days : DEFAULT_BAN_RETENTION_DAYS) * 24 * 60 * 60;
	}

	/** Ver `buildBanSchema`: los índices se sincronizan acá para que un cambio del TTL no rompa el arranque. */
	async #ensureIndexes(model: Model<BanRecord>): Promise<void> {
		try {
			await model.syncIndexes();
		} catch (err: any) {
			this.logger.logWarn(`[ModerationService] syncIndexes de bans falló: ${err?.message || err}`);
		}
	}

	async #minimizeInactive(): Promise<void> {
		try {
			const n = await this.#requireRepo().minimizeInactiveBans();
			if (n) this.logger.logInfo(`[ModerationService] ${n} ban(s) inactivos minimizados`);
		} catch (err: any) {
			this.logger.logWarn(`[ModerationService] minimización de bans inactivos falló: ${err?.message || err}`);
		}
	}

	/**
	 * Corre `fn` sólo en el nodo que tenga el lease. Sin `OperationsService` corre igual: en un
	 * despliegue de un nodo negarse sería peor que el trabajo duplicado que evita.
	 */
	async #onlyOnLeader(name: string, ttlSeconds: number, fn: () => Promise<void>): Promise<void> {
		const ops = this.tryGetMyService<IOperationsService>("OperationsService");
		if (ops) await ops.withLeadership(name, ttlSeconds, fn);
		else await fn();
	}

	#startExpiredSweep(): void {
		const sweep = async () => {
			try {
				await this.#onlyOnLeader("moderation.expired-sweep", 3600, () => this.#expiredSweepBatch());
			} catch (err: any) {
				this.logger.logWarn(`[ModerationService] barrido de bans vencidos falló: ${err?.message || err}`);
			}
		};
		void sweep();
		this.#expiredSweep = setInterval(() => void sweep(), EXPIRED_SWEEP_INTERVAL_MS);
	}

	/**
	 * El barrido es idempotente (un `updateMany` por filtro y guardas por usuario en la
	 * reactivación), así que correrlo en varios nodos no corrompe nada: repite consultas y vuelve a
	 * loguear —y a alertar— reactivaciones que ya hizo otro nodo. El lease es para ahorrarse ese
	 * ruido y ese trabajo, no para proteger la consistencia.
	 */
	async #expiredSweepBatch(): Promise<void> {
		const { count, userIds } = await this.#requireRepo().deactivateExpiredBans();
		if (count) this.logger.logInfo(`[ModerationService] ${count} ban(s) vencidos desactivados y minimizados`);
		await this.#reactivateAfterExpiredBans(userIds);
	}

	/**
	 * Reactiva las cuentas cuyo ban temporal acaba de vencer. Sin esto la fila queda inactiva pero
	 * `isActive` sigue en `false`, así que el login sigue rechazando hasta un unban manual: la
	 * sanción temporal se comportaba como permanente.
	 *
	 * Va por los managers INTERNOS (el barrido no tiene actor ni token que ofrecer) y sólo levanta
	 * la desactivación cuando la causa es exactamente ese ban vencido: `unbanUser` borra también
	 * `scheduledDeletionAt`/`deletionReason`/`deletionRequestedAt`/`deletionCancelTokenHash`, de modo
	 * que reactivar a ciegas RESUCITARÍA una cuenta que pidió la baja antes de que la banearan.
	 * Un usuario que falle no corta el resto.
	 */
	async #reactivateAfterExpiredBans(userIds: string[]): Promise<void> {
		if (!userIds.length) return;
		if (!this.#identityService) {
			this.logger.logWarn(`[ModerationService] IdentityManagerService no disponible: ${userIds.length} cuenta(s) siguen desactivadas`);
			return;
		}
		const identity = this.#identityService;
		const internal = identity._internal(this.getCapability());
		const now = Date.now();
		const reactivated: string[] = [];

		for (const userId of userIds) {
			try {
				const user = await internal.users.getUser(userId);
				if (!user || user.isActive) continue;
				const meta = (user.metadata ?? {}) as Record<string, unknown>;
				if (!meta.bannedAt) continue; // inactiva por otra cosa (baja, desactivación admin)
				const expiresAt = meta.banExpiresAt;
				if (!expiresAt || new Date(expiresAt as string | Date).getTime() > now) continue;
				// Con una baja programada encima NO se toca, aunque el ban haya vencido: `unbanUser`
				// la borraría junto con la metadata del ban y la cuenta volvería de entre los muertos
				// (o peor, con la cascada de purga ya empezada). Ahí decide un unban manual.
				if (meta.scheduledDeletionAt) {
					this.logger.logWarn(`[ModerationService] ${userId} tiene baja programada: el ban venció pero la reactivación queda a mano`);
					continue;
				}

				await internal.users.unbanUser(userId);
				identity.permissions.invalidateUser(userId);
				reactivated.push(userId);
			} catch (err: any) {
				this.logger.logWarn(`[ModerationService] reactivación de ${userId} tras ban vencido falló: ${err?.message || err}`);
			}
		}

		if (!reactivated.length) return;
		this.logger.logInfo(`[ModerationService] ${reactivated.length} cuenta(s) reactivadas por vencimiento del ban`);
		this.#notifySecurity({
			title: "Bans vencidos: cuentas reactivadas",
			body: `Vencieron ${reactivated.length} ban(s) temporal(es) y las cuentas volvieron a estar activas.`,
			data: { userIds: reactivated },
		});
	}

	/** Crea ban anti-evasión a partir de un usuario; recolecta email/linkedEmails e IPs recientes (3h). */
	async #banPlatformUser(
		user: Pick<User, "id" | "email" | "linkedAccounts" | "lastLogin">,
		args: { reason: string; expiresAt?: Date | null; source?: BanInput["source"]; externalId?: string }
	): Promise<BanRecord> {
		const repo = this.#requireRepo();
		const emails: (string | undefined | null)[] = [user.email];
		for (const acc of user.linkedAccounts || []) {
			const email = (acc as { email?: string }).email;
			if (email) emails.push(email);
		}
		const record = await repo.addBan({
			emails,
			extraIpHashes: await repo.getRecentIpHashes(user.id),
			reason: args.reason,
			lastLoginAt: user.lastLogin ?? null,
			expiresAt: args.expiresAt ?? null,
			source: args.source ?? "manual",
			externalId: args.externalId,
			userId: user.id,
		});
		await repo.clearLoginIps(user.id);
		return record;
	}

	/** Orquesta baneo de usuario plataforma: marca User.banned + invalida permisos + alimenta blocklist. */
	async #banUserById(userId: string, args: { reason: string; expiresAt?: Date | null }, token: string): Promise<BanRecord> {
		if (!this.#identityService) throw new Error("IdentityManagerService no disponible");
		const user = await this.#identityService.users.getUser(userId, token);
		if (!user) throw new ModerationError(404, "USER_NOT_FOUND", "Usuario no encontrado");

		await this.#identityService.users.banUser(userId, { reason: args.reason, expiresAt: args.expiresAt ?? null }, token);
		try {
			const record = await this.#banPlatformUser(user, { reason: args.reason, expiresAt: args.expiresAt, source: "manual" });
			this.#notifySecurity({
				title: "Usuario baneado",
				body: `Se aplicó un ban a ${user.username ?? userId}. Motivo: ${args.reason}`,
				data: { userId, expiresAt: args.expiresAt?.toISOString() ?? null },
			});
			return record;
		} catch (err: any) {
			this.logger.logWarn(`[banUserById] blocklist falló: ${err?.message || err}`);
			throw err;
		} finally {
			this.#identityService.permissions.invalidateUser(userId);
		}
	}

	async #unbanUserById(userId: string, reason: string | undefined, token: string): Promise<number> {
		if (!this.#identityService) throw new Error("IdentityManagerService no disponible");
		const authed = this.#authedRepo ?? this.#requireRepo();
		await this.#identityService.users.unbanUser(userId, token);
		try {
			const removed = await authed.deactivateBans({ userId }, reason, token);
			const reasonTxt = reason ? ` Motivo: ${reason}` : "";
			this.#notifySecurity({
				title: "Ban levantado",
				body: `Se levantó el ban de ${userId}.${reasonTxt}`,
				data: { userId },
			});
			return removed;
		} finally {
			this.#identityService.permissions.invalidateUser(userId);
		}
	}

	async #waitConnected(provider: MongoProvider): Promise<void> {
		const t0 = Date.now();
		while (!provider.isConnected() && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 250));
		if (!provider.isConnected()) throw new Error("[ModerationService] Mongo no se conectó en el tiempo esperado");
	}

	#tryGet<T>(kind: "provider" | "service", name: string): T | null {
		try {
			return kind === "provider" ? this.getMyProvider<T>(name) : this.getMyService<T>(name);
		} catch {
			return null;
		}
	}
}
