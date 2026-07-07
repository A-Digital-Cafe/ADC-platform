import { BaseService } from "../../BaseService.js";
import type MongoProvider from "../../../providers/object/mongo/index.js";
import type RedisProvider from "../../../providers/queue/redis/index.js";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";
import type { Kernel } from "../../../kernel.js";
import type { BanRecord, BanInput, BanLookupResult } from "@common/types/identity/Moderation.js";
import type { User } from "@common/types/identity/User.js";
import { Scope, assertScope, type CapabilityToken } from "@common/security/Capability.ts";
import type { IModerationService } from "@common/types/identity/IModerationService.ts";

import { assertCanManageUser } from "../../core/IdentityManagerService/domain/hierarchy.js";
import { ModerationError } from "@common/types/custom-errors/ModerationError.ts";
import { banSchema } from "./domain/ban.js";
import { BanRepository } from "./dao/BanRepository.js";
import { DiscordSyncRunner } from "./sync/DiscordSyncRunner.js";
import { EnableEndpoints, DisableEndpoints } from "../../core/EndpointManagerService/index.js";
import { BanEndpoints } from "./endpoints/bans.js";

interface ModerationPrivateConfig {
	discord?: { syncEnabled?: boolean | string; syncIntervalMs?: number };
}

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
	listBans(opts: { activeOnly?: boolean; limit?: number }, token: string): Promise<BanRecord[]>;
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

	constructor(kernel: Kernel, options?: any) {
		super(kernel, options);
		this.#mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
	}

	@EnableEndpoints({ managers: () => [BanEndpoints] })
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		await this.#waitConnected(this.#mongoProvider);

		const BanModel = this.#mongoProvider.createModel<BanRecord>("Ban", banSchema);
		const redis = this.#tryGet<RedisProvider>("provider", "queue/redis");
		if (!redis) this.logger.logWarn("[ModerationService] Redis no disponible. Lookups serán Mongo-only.");

		this.#repo = new BanRepository(BanModel, redis, this.logger);
		await this.#repo.warmupRedisCache();

		this.#identityService = this.#tryGet<IIdentityManagerService>("service", "IdentityManagerService");
		this.#authedRepo = this.#identityService
			? new BanRepository(BanModel, redis, this.logger, () => this.#identityService!.createAuthVerifier())
			: this.#repo;

		const pengubot = this.#tryGet<MongoProvider>("provider", "pengubot@object/mongo");
		if (pengubot && this.#identityService) {
			this.#sync = new DiscordSyncRunner(
				this.#repo,
				(u, a) => this.#banPlatformUser(u, a),
				this.#identityService,
				this.getCapability(),
				this.logger
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
