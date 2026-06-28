import { safeParseJson } from "@common/utils/json-schema.ts";
import { userBlockStatusCheck, type UserBlockStatus } from "../../schemas/block-status.js";
import type RedisProvider from "../../../../../providers/queue/redis/index.js";

/** Prefijos de claves Redis */
const REDIS_PREFIX = {
	LOGIN_ATTEMPTS: "security:login:",
	REFRESH_ATTEMPTS: "security:refresh:",
	BLOCK_STATUS: "security:block:",
	WAS_TEMP_BLOCKED: "security:was_temp_blocked",
} as const;

/** TTLs en segundos */
const TTL = {
	LOGIN_ATTEMPTS: 24 * 60 * 60, // 24 horas
	REFRESH_ATTEMPTS: 5 * 60, // 5 minutos
	BLOCK_TEMP: 60 * 60, // 1 hora
	BLOCK_PERM: 30 * 24 * 60 * 60, // 30 días
} as const;

type UpdateBlockStatusCallback = (userId: string, blocked: boolean | number) => Promise<void>;
type SendAlertEmailCallback = (userId: string, reason: string) => Promise<void>;

const NOT_BLOCKED: UserBlockStatus = { blocked: false, blockedUntil: null, permanent: false, reason: "" };

/**
 * LoginAttemptTracker - Seguimiento de intentos de login y refresh
 *
 * Soporta Redis para persistencia distribuida.
 * Sin Redis, funciona con almacenamiento en memoria.
 */
export class LoginAttemptTracker {
	readonly #redis: RedisProvider | null = null;
	#updateBlockStatus: UpdateBlockStatusCallback | null = null;
	#sendAlertEmail: SendAlertEmailCallback | null = null;

	// Fallback en memoria
	readonly #loginAttempts = new Map<string, number>();
	readonly #refreshAttempts = new Map<string, number>();
	readonly #blockStatus = new Map<string, UserBlockStatus>();
	readonly #temporarilyBlocked = new Set<string>();
	#cleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(redis?: RedisProvider) {
		this.#redis = redis || null;

		if (!this.#redis) {
			this.#cleanupTimer = setInterval(() => this.#cleanup(), 60 * 60 * 1000);
		}
	}

	stop(): void {
		if (this.#cleanupTimer) {
			clearInterval(this.#cleanupTimer);
			this.#cleanupTimer = null;
		}
	}

	setCallbacks(updateBlockStatus: UpdateBlockStatusCallback, sendAlertEmail?: SendAlertEmailCallback): void {
		this.#updateBlockStatus = updateBlockStatus;
		this.#sendAlertEmail = sendAlertEmail || null;
	}

	/**
	 * Verifica si un usuario está bloqueado
	 */
	async isBlocked(userId: string): Promise<UserBlockStatus> {
		if (this.#redis) {
			const data = await this.#redis.get(`${REDIS_PREFIX.BLOCK_STATUS}${userId}`);
			const status = safeParseJson(data, userBlockStatusCheck);
			if (!status) return NOT_BLOCKED;

			// Si es temporal y ya pasó
			if (status.blockedUntil && Date.now() > status.blockedUntil) {
				await this.#redis.sadd(REDIS_PREFIX.WAS_TEMP_BLOCKED, userId);
				await this.#redis.del(`${REDIS_PREFIX.BLOCK_STATUS}${userId}`);
				return NOT_BLOCKED;
			}

			return status;
		}

		const status = this.#blockStatus.get(userId);
		if (!status) return NOT_BLOCKED;

		if (status.blockedUntil && Date.now() > status.blockedUntil) {
			this.#temporarilyBlocked.add(userId);
			this.#blockStatus.delete(userId);
			return NOT_BLOCKED;
		}

		return status;
	}

	/**
	 * Registra un intento de login
	 */
	async recordLoginAttempt(userId: string, success: boolean, _ipAddress: string): Promise<UserBlockStatus> {
		const currentStatus = await this.isBlocked(userId);
		if (currentStatus.blocked) return currentStatus;

		if (success) {
			await this.#clearLoginAttempts(userId);
			return NOT_BLOCKED;
		}

		const failedCount = await this.#incrementLoginAttempts(userId);

		if (failedCount >= 3) {
			const wasTempBlocked = await this.#wasTemporarilyBlocked(userId);

			if (wasTempBlocked) {
				return this.#blockUser(userId, true, "Múltiples intentos fallidos de login tras desbloqueo");
			}

			return this.#blockUser(userId, Date.now() + TTL.BLOCK_TEMP * 1000, "3 intentos fallidos de login");
		}

		return NOT_BLOCKED;
	}

	/**
	 * Registra un intento de refresh
	 */
	async recordRefreshAttempt(
		userId: string,
		success: boolean
	): Promise<{
		blocked: boolean;
		shouldDeleteTokens: boolean;
		status: UserBlockStatus;
	}> {
		const currentStatus = await this.isBlocked(userId);
		if (currentStatus.blocked) {
			return { blocked: true, shouldDeleteTokens: false, status: currentStatus };
		}

		if (success) {
			await this.#clearRefreshAttempts(userId);
			return { blocked: false, shouldDeleteTokens: false, status: NOT_BLOCKED };
		}

		const failedCount = await this.#incrementRefreshAttempts(userId);

		if (failedCount >= 3) {
			const status = await this.#blockUser(userId, true, "Intento de uso fraudulento de refresh tokens");
			return { blocked: true, shouldDeleteTokens: true, status };
		}

		return { blocked: false, shouldDeleteTokens: false, status: NOT_BLOCKED };
	}

	async unblockUser(userId: string): Promise<void> {
		if (this.#redis) {
			await Promise.all([
				this.#redis.del(`${REDIS_PREFIX.BLOCK_STATUS}${userId}`),
				this.#redis.del(`${REDIS_PREFIX.LOGIN_ATTEMPTS}${userId}`),
				this.#redis.del(`${REDIS_PREFIX.REFRESH_ATTEMPTS}${userId}`),
				this.#redis.srem(REDIS_PREFIX.WAS_TEMP_BLOCKED, userId),
			]);
		} else {
			this.#blockStatus.delete(userId);
			this.#loginAttempts.delete(userId);
			this.#refreshAttempts.delete(userId);
			this.#temporarilyBlocked.delete(userId);
		}

		if (this.#updateBlockStatus) {
			await this.#updateBlockStatus(userId, false);
		}
	}

	// === Métodos privados ===

	async #incrementLoginAttempts(userId: string): Promise<number> {
		if (this.#redis) {
			const key = `${REDIS_PREFIX.LOGIN_ATTEMPTS}${userId}`;
			const count = await this.#redis.incr(key);
			if (count === 1) {
				await this.#redis.expire(key, TTL.LOGIN_ATTEMPTS);
			}
			return count;
		}

		const current = this.#loginAttempts.get(userId) || 0;
		this.#loginAttempts.set(userId, current + 1);
		return current + 1;
	}

	async #clearLoginAttempts(userId: string): Promise<void> {
		if (this.#redis) {
			await this.#redis.del(`${REDIS_PREFIX.LOGIN_ATTEMPTS}${userId}`);
		} else {
			this.#loginAttempts.delete(userId);
		}
	}

	async #incrementRefreshAttempts(userId: string): Promise<number> {
		if (this.#redis) {
			const key = `${REDIS_PREFIX.REFRESH_ATTEMPTS}${userId}`;
			const count = await this.#redis.incr(key);
			if (count === 1) {
				await this.#redis.expire(key, TTL.REFRESH_ATTEMPTS);
			}
			return count;
		}

		const current = this.#refreshAttempts.get(userId) || 0;
		this.#refreshAttempts.set(userId, current + 1);
		return current + 1;
	}

	async #clearRefreshAttempts(userId: string): Promise<void> {
		if (this.#redis) {
			await this.#redis.del(`${REDIS_PREFIX.REFRESH_ATTEMPTS}${userId}`);
		} else {
			this.#refreshAttempts.delete(userId);
		}
	}

	async #wasTemporarilyBlocked(userId: string): Promise<boolean> {
		if (this.#redis) {
			return this.#redis.sismember(REDIS_PREFIX.WAS_TEMP_BLOCKED, userId);
		}
		return this.#temporarilyBlocked.has(userId);
	}

	async #blockUser(userId: string, blockedUntilOrPermanent: number | boolean, reason: string): Promise<UserBlockStatus> {
		const permanent = blockedUntilOrPermanent === true;
		const blockedUntil = typeof blockedUntilOrPermanent === "number" ? blockedUntilOrPermanent : null;

		const status: UserBlockStatus = {
			blocked: true,
			blockedUntil,
			permanent,
			reason,
		};

		const ttl = permanent ? TTL.BLOCK_PERM : TTL.BLOCK_TEMP;

		if (this.#redis) {
			await this.#redis.setex(`${REDIS_PREFIX.BLOCK_STATUS}${userId}`, ttl, JSON.stringify(status));
		} else {
			this.#blockStatus.set(userId, status);
		}

		if (this.#updateBlockStatus) {
			await this.#updateBlockStatus(userId, permanent ? true : blockedUntil!);
		}

		if (this.#sendAlertEmail && permanent) {
			try {
				await this.#sendAlertEmail(userId, reason);
			} catch {
				// Silenciar
			}
		}

		return status;
	}

	#cleanup(): void {
		// En memoria, simplemente limpiamos los contadores viejos
		// (en Redis el TTL se encarga automáticamente)
		this.#loginAttempts.clear();
		this.#refreshAttempts.clear();
	}
}
