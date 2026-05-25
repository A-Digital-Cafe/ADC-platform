import type { Model } from "mongoose";
import type RedisProvider from "../../../../providers/queue/redis/index.js";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { BanRecord, BanInput, BanLookupResult } from "@common/types/identity/Moderation.js";
import { hashEmails, hashIp } from "@common/utils/identityHash.ts";
import { generateId } from "@common/utils/crypto.ts";
import { type AuthVerifierGetter, PermissionChecker } from "@common/types/auth-verifier.ts";
import { IdentityScopes, RESOURCE_NAME } from "@common/types/identity/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.ts";

const REDIS = {
	EMAIL_SET: "mod:bans:emails",
	IP_SET: "mod:bans:ips",
	LOGIN_IPS_PREFIX: "mod:loginips:", // {userId} → SET of ipHashes
	EMAIL_META_PREFIX: "mod:ban:email:", // {hash} → JSON { expiresAt, reason }
	IP_META_PREFIX: "mod:ban:ip:",
} as const;

const LOGIN_IPS_TTL_SECONDS = 3 * 60 * 60;

/**
 * BanRepository — capa de persistencia + cache para el sistema anti-evasión.
 *
 * Doble almacenamiento:
 *  - Mongo es la fuente de verdad (índices multikey en emailHashes/ipHashes).
 *  - Redis mantiene SETs de hashes activos para lookups O(1) en login.
 *
 * Redis se warmup al arrancar y se actualiza incrementalmente con cada add/remove.
 * Si Redis falla, los lookups caen a Mongo (correctness > performance).
 */
export class BanRepository {
	readonly #permissionChecker: PermissionChecker;

	constructor(
		private readonly model: Model<BanRecord>,
		private readonly redis: RedisProvider | null,
		private readonly logger: ILogger,
		getAuthVerifier: AuthVerifierGetter = () => null
	) {
		this.#permissionChecker = new PermissionChecker(getAuthVerifier, "BanRepository", RESOURCE_NAME);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Warmup
	// ─────────────────────────────────────────────────────────────────────────

	async warmupRedisCache(): Promise<void> {
		if (!this.redis) return;
		try {
			const now = new Date();
			const docs = await this.model
				.find(
					{
						active: true,
						$or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
					},
					{ emailHashes: 1, ipHashes: 1, _id: 0 }
				)
				.lean();

			const emails = new Set<string>();
			const ips = new Set<string>();
			for (const d of docs) {
				for (const h of d.emailHashes || []) emails.add(h);
				for (const h of d.ipHashes || []) ips.add(h);
			}
			// Limpieza + rebuild
			await this.redis.del(REDIS.EMAIL_SET);
			await this.redis.del(REDIS.IP_SET);
			if (emails.size) await this.redis.sadd(REDIS.EMAIL_SET, ...emails);
			if (ips.size) await this.redis.sadd(REDIS.IP_SET, ...ips);

			this.logger.logInfo(`[ModerationService] Redis warmup: ${emails.size} emails, ${ips.size} ips`);
		} catch (err: any) {
			this.logger.logWarn(`[ModerationService] Redis warmup falló: ${err.message}`);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Lookups (login hot-path)
	// ─────────────────────────────────────────────────────────────────────────

	async isEmailBanned(rawEmail: string): Promise<BanLookupResult> {
		const hashes = hashEmails([rawEmail]);
		if (!hashes.length) return { banned: false };
		const hash = hashes[0];

		// Fast path: Redis
		if (this.redis) {
			try {
				const member = await this.redis.sismember(REDIS.EMAIL_SET, hash);
				if (!member) return { banned: false };
			} catch (err: any) {
				this.logger.logWarn(`[ModerationService] Redis sismember falló: ${err.message}`);
			}
		}

		// Confirmar contra Mongo (lookup adicional para devolver expiresAt/reason precisos)
		const doc = await this.model
			.findOne(
				{
					active: true,
					emailHashes: hash,
					$or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
				},
				{ expiresAt: 1, reason: 1, _id: 0 }
			)
			.lean();

		if (!doc) {
			// Drift: estaba en Redis pero no en Mongo (o ya expiró). Limpia.
			if (this.redis) {
				try {
					await this.redis.srem(REDIS.EMAIL_SET, hash);
				} catch {
					/* ignore */
				}
			}
			return { banned: false };
		}

		return { banned: true, expiresAt: doc.expiresAt ?? null, reason: doc.reason };
	}

	async isIpBanned(rawIp: string): Promise<BanLookupResult> {
		const hash = hashIp(rawIp);
		if (!hash) return { banned: false };

		if (this.redis) {
			try {
				const member = await this.redis.sismember(REDIS.IP_SET, hash);
				if (!member) return { banned: false };
			} catch (err: any) {
				this.logger.logWarn(`[ModerationService] Redis sismember(ip) falló: ${err.message}`);
			}
		}

		const doc = await this.model
			.findOne(
				{
					active: true,
					ipHashes: hash,
					$or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
				},
				{ expiresAt: 1, reason: 1, _id: 0 }
			)
			.lean();

		if (!doc) {
			if (this.redis) {
				try {
					await this.redis.srem(REDIS.IP_SET, hash);
				} catch {
					/* ignore */
				}
			}
			return { banned: false };
		}
		return { banned: true, expiresAt: doc.expiresAt ?? null, reason: doc.reason };
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Login attempt IP buffer (3h window)
	// ─────────────────────────────────────────────────────────────────────────

	async recordLoginIp(userId: string, rawIp: string): Promise<void> {
		if (!this.redis || !userId) return;
		const hash = hashIp(rawIp);
		if (!hash) return;
		try {
			const key = `${REDIS.LOGIN_IPS_PREFIX}${userId}`;
			await this.redis.sadd(key, hash);
			await this.redis.expire(key, LOGIN_IPS_TTL_SECONDS);
		} catch (err: any) {
			this.logger.logWarn(`[ModerationService] recordLoginIp falló: ${err.message}`);
		}
	}

	async getRecentIpHashes(userId: string): Promise<string[]> {
		if (!this.redis || !userId) return [];
		try {
			return await this.redis.smembers(`${REDIS.LOGIN_IPS_PREFIX}${userId}`);
		} catch {
			return [];
		}
	}

	async clearLoginIps(userId: string): Promise<void> {
		if (!this.redis || !userId) return;
		try {
			await this.redis.del(`${REDIS.LOGIN_IPS_PREFIX}${userId}`);
		} catch {
			/* ignore */
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Mutations
	// ─────────────────────────────────────────────────────────────────────────

	async addBan(input: BanInput, token?: string): Promise<BanRecord> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, IdentityScopes.USERS);

		const emailHashes = hashEmails(input.emails);
		const ipHashesFromIps = (input.ips || []).map((ip) => (ip ? hashIp(ip) : null)).filter((h): h is string => !!h);
		const ipHashes = Array.from(new Set([...ipHashesFromIps, ...(input.extraIpHashes || [])]));

		// Idempotencia por source+externalId
		if (input.externalId && input.source !== "manual") {
			const existing = await this.model.findOne({ source: input.source, externalId: input.externalId, active: true });
			if (existing) {
				// Refresca reason / expiresAt si cambió
				existing.reason = input.reason || existing.reason;
				existing.expiresAt = input.expiresAt ?? existing.expiresAt;
				// Merge hashes (sin duplicados)
				existing.emailHashes = Array.from(new Set([...existing.emailHashes, ...emailHashes]));
				existing.ipHashes = Array.from(new Set([...existing.ipHashes, ...ipHashes]));
				await existing.save();
				await this.#syncRedisAdd(existing.emailHashes, existing.ipHashes);
				return existing.toObject?.() || (existing as any);
			}
		}

		const record: BanRecord = {
			id: generateId(),
			emailHashes,
			ipHashes,
			reason: input.reason || "",
			lastLoginAt: input.lastLoginAt ?? null,
			bannedAt: new Date(),
			expiresAt: input.expiresAt ?? null,
			source: input.source,
			externalId: input.externalId,
			userId: input.userId,
			active: true,
		};
		await this.model.create(record);
		await this.#syncRedisAdd(emailHashes, ipHashes);
		return record;
	}

	/** Desactiva todos los bans (active=true) que coincidan por userId o externalId. */
	async deactivateBans(filter: { userId?: string; source?: string; externalId?: string }, reason?: string, token?: string): Promise<number> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		const query: Record<string, unknown> = { active: true };
		if (filter.userId) query.userId = filter.userId;
		if (filter.source) query.source = filter.source;
		if (filter.externalId) query.externalId = filter.externalId;
		if (Object.keys(query).length === 1) return 0; // safety: never deactivate everything

		const docs = await this.model.find(query).lean();
		if (!docs.length) return 0;

		const allEmails = new Set<string>();
		const allIps = new Set<string>();
		for (const d of docs) {
			for (const h of d.emailHashes || []) allEmails.add(h);
			for (const h of d.ipHashes || []) allIps.add(h);
		}

		await this.model.updateMany(query, {
			$set: { active: false, unbannedAt: new Date(), unbanReason: reason || "" },
		});

		// Rebuild Redis selectivamente: solo eliminamos los hashes que ya no estén
		// referenciados por ningún ban activo restante.
		await this.#syncRedisRemoveIfOrphan([...allEmails], [...allIps]);
		return docs.length;
	}

	async listBans(opts: { activeOnly?: boolean; limit?: number } = {}, token?: string): Promise<BanRecord[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		const filter: Record<string, unknown> = {};
		if (opts.activeOnly !== false) filter.active = true;
		const docs = await this.model
			.find(filter)
			.sort({ bannedAt: -1 })
			.limit(opts.limit ?? 200)
			.lean();
		return docs as unknown as BanRecord[];
	}

	async findActiveByExternalId(source: string, externalId: string, token?: string): Promise<BanRecord | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		const doc = await this.model.findOne({ source, externalId, active: true }).lean();
		return (doc as unknown as BanRecord) || null;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Redis sync helpers
	// ─────────────────────────────────────────────────────────────────────────

	async #syncRedisAdd(emails: string[], ips: string[]): Promise<void> {
		if (!this.redis) return;
		try {
			if (emails.length) await this.redis.sadd(REDIS.EMAIL_SET, ...emails);
			if (ips.length) await this.redis.sadd(REDIS.IP_SET, ...ips);
		} catch (err: any) {
			this.logger.logWarn(`[ModerationService] Redis sadd falló: ${err.message}`);
		}
	}

	async #syncRedisRemoveIfOrphan(emails: string[], ips: string[]): Promise<void> {
		if (!this.redis || (!emails.length && !ips.length)) return;
		try {
			// Para cada hash, verifica si queda algún ban activo que lo use.
			for (const h of emails) {
				const stillActive = await this.model.exists({
					active: true,
					emailHashes: h,
					$or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
				});
				if (!stillActive) await this.redis.srem(REDIS.EMAIL_SET, h);
			}
			for (const h of ips) {
				const stillActive = await this.model.exists({
					active: true,
					ipHashes: h,
					$or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
				});
				if (!stillActive) await this.redis.srem(REDIS.IP_SET, h);
			}
		} catch (err: any) {
			this.logger.logWarn(`[ModerationService] Redis srem falló: ${err.message}`);
		}
	}
}
