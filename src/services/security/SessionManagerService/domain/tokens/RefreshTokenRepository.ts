import { randomBytes } from "node:crypto";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { storedRefreshTokenCheck, type StoredRefreshToken } from "../../schemas/refresh-token.js";
import type RedisProvider from "../../../../../providers/queue/redis/index.js";

export type { StoredRefreshToken };

/** Prefijos de claves Redis */
const REDIS_PREFIX = {
	TOKEN: "refresh:token:",
	USER: "refresh:user:",
	DEVICE: "refresh:device:",
} as const;

/**
 * Opciones para crear un refresh token
 */
interface CreateRefreshTokenOptions {
	userId: string;
	deviceId: string;
	ipAddress: string;
	country: string | null;
	userAgent: string;
	ttlSeconds?: number;
}

/**
 * RefreshTokenRepository - Almacenamiento de Refresh Tokens
 *
 * Soporta Redis para persistencia distribuida.
 * Sin Redis, funciona con almacenamiento en memoria.
 */
export class RefreshTokenRepository {
	readonly #redis: RedisProvider | null = null;
	readonly #defaultTtl: number;

	// Fallback en memoria
	readonly #tokens = new Map<string, StoredRefreshToken>();
	readonly #userTokens = new Map<string, Set<string>>();
	readonly #deviceTokens = new Map<string, string>();
	#cleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(defaultTtlSeconds: number = 30 * 24 * 60 * 60, redis?: RedisProvider) {
		this.#defaultTtl = defaultTtlSeconds;
		this.#redis = redis || null;

		// Limpieza periódica solo si no hay Redis (Redis usa TTL nativo)
		if (!this.#redis) {
			this.#cleanupTimer = setInterval(() => this.#cleanupExpired(), 60 * 60 * 1000);
		}
	}

	/**
	 * Detiene el timer de limpieza
	 */
	stop(): void {
		if (this.#cleanupTimer) {
			clearInterval(this.#cleanupTimer);
			this.#cleanupTimer = null;
		}
	}

	/**
	 * Crea un nuevo refresh token
	 */
	async create(options: CreateRefreshTokenOptions): Promise<StoredRefreshToken> {
		const token = this.#generateToken();
		const now = Date.now();
		const ttl = options.ttlSeconds || this.#defaultTtl;
		const deviceKey = `${options.userId}:${options.deviceId}`;

		// Revocar token anterior del mismo dispositivo
		if (this.#redis) {
			const existingToken = await this.#redis.get(`${REDIS_PREFIX.DEVICE}${deviceKey}`);
			if (existingToken) {
				await this.revoke(existingToken);
			}
		} else {
			const existingToken = this.#deviceTokens.get(deviceKey);
			if (existingToken) {
				await this.revoke(existingToken);
			}
		}

		const storedToken: StoredRefreshToken = {
			token,
			userId: options.userId,
			deviceId: options.deviceId,
			createdAt: now,
			expiresAt: now + ttl * 1000,
			ipAddress: options.ipAddress,
			country: options.country,
			userAgent: options.userAgent,
			revoked: false,
		};

		if (this.#redis) {
			await Promise.all([
				this.#redis.setex(`${REDIS_PREFIX.TOKEN}${token}`, ttl, JSON.stringify(storedToken)),
				this.#redis.setex(`${REDIS_PREFIX.DEVICE}${deviceKey}`, ttl, token),
				this.#redis.sadd(`${REDIS_PREFIX.USER}${options.userId}`, token),
			]);
		} else {
			this.#tokens.set(token, storedToken);
			this.#deviceTokens.set(deviceKey, token);
			if (!this.#userTokens.has(options.userId)) {
				this.#userTokens.set(options.userId, new Set());
			}
			this.#userTokens.get(options.userId)!.add(token);
		}

		return storedToken;
	}

	/**
	 * Busca un refresh token por valor
	 */
	async findByToken(token: string): Promise<StoredRefreshToken | null> {
		if (this.#redis) {
			const data = await this.#redis.get(`${REDIS_PREFIX.TOKEN}${token}`);
			const stored = safeParseJson(data, storedRefreshTokenCheck);
			if (!stored || stored.revoked || Date.now() > stored.expiresAt) return null;
			return stored;
		}

		const stored = this.#tokens.get(token);
		if (!stored || stored.revoked || Date.now() > stored.expiresAt) return null;
		return stored;
	}

	/**
	 * Busca un refresh token por usuario y dispositivo
	 */
	async findByUserAndDevice(userId: string, deviceId: string): Promise<StoredRefreshToken | null> {
		const deviceKey = `${userId}:${deviceId}`;

		if (this.#redis) {
			const token = await this.#redis.get(`${REDIS_PREFIX.DEVICE}${deviceKey}`);
			if (!token) return null;
			return this.findByToken(token);
		}

		const token = this.#deviceTokens.get(deviceKey);
		if (!token) return null;
		return this.findByToken(token);
	}

	/**
	 * Revoca un token específico
	 */
	async revoke(token: string): Promise<boolean> {
		if (this.#redis) {
			const data = await this.#redis.get(`${REDIS_PREFIX.TOKEN}${token}`);
			const stored = safeParseJson(data, storedRefreshTokenCheck);
			if (!stored) return false;

			stored.revoked = true;

			await Promise.all([
				this.#redis.set(`${REDIS_PREFIX.TOKEN}${token}`, JSON.stringify(stored), 60), // Mantener 1 min para evitar reuso
				this.#redis.del(`${REDIS_PREFIX.DEVICE}${stored.userId}:${stored.deviceId}`),
				this.#redis.srem(`${REDIS_PREFIX.USER}${stored.userId}`, token),
			]);
			return true;
		}

		const stored = this.#tokens.get(token);
		if (!stored) return false;

		stored.revoked = true;
		this.#deviceTokens.delete(`${stored.userId}:${stored.deviceId}`);
		return true;
	}

	/**
	 * Revoca todos los tokens de un usuario
	 */
	async revokeAllForUser(userId: string): Promise<number> {
		if (this.#redis) {
			const tokens = await this.#redis.smembers(`${REDIS_PREFIX.USER}${userId}`);
			if (tokens.length === 0) return 0;

			let count = 0;
			for (const token of tokens) {
				if (await this.revoke(token)) count++;
			}
			return count;
		}

		const userTokens = this.#userTokens.get(userId);
		if (!userTokens) return 0;

		let count = 0;
		for (const token of userTokens) {
			const stored = this.#tokens.get(token);
			if (stored && !stored.revoked) {
				stored.revoked = true;
				this.#deviceTokens.delete(`${stored.userId}:${stored.deviceId}`);
				count++;
			}
		}
		return count;
	}

	/**
	 * Rota un refresh token (borra el viejo, crea uno nuevo)
	 */
	async rotate(oldToken: string, options: Omit<CreateRefreshTokenOptions, "userId" | "deviceId">): Promise<StoredRefreshToken | null> {
		const existing = await this.findByToken(oldToken);
		if (!existing) return null;

		await this.revoke(oldToken);

		return this.create({
			userId: existing.userId,
			deviceId: existing.deviceId,
			...options,
		});
	}

	/**
	 * Elimina físicamente todos los tokens de un usuario
	 */
	async deleteAllForUser(userId: string): Promise<number> {
		if (this.#redis) {
			const tokens = await this.#redis.smembers(`${REDIS_PREFIX.USER}${userId}`);
			if (tokens.length === 0) return 0;

			const deletePromises = tokens.map(async (token) => {
				const data = await this.#redis!.get(`${REDIS_PREFIX.TOKEN}${token}`);
				const stored = safeParseJson(data, storedRefreshTokenCheck);
				if (stored) {
					await this.#redis!.del(`${REDIS_PREFIX.DEVICE}${stored.userId}:${stored.deviceId}`);
				}
				await this.#redis!.del(`${REDIS_PREFIX.TOKEN}${token}`);
			});

			await Promise.all(deletePromises);
			await this.#redis.del(`${REDIS_PREFIX.USER}${userId}`);
			return tokens.length;
		}

		const userTokens = this.#userTokens.get(userId);
		if (!userTokens) return 0;

		let count = 0;
		for (const token of userTokens) {
			const stored = this.#tokens.get(token);
			if (stored) {
				this.#deviceTokens.delete(`${stored.userId}:${stored.deviceId}`);
				this.#tokens.delete(token);
				count++;
			}
		}

		this.#userTokens.delete(userId);
		return count;
	}

	#generateToken(): string {
		return randomBytes(48).toString("base64url");
	}

	#cleanupExpired(): void {
		const now = Date.now();

		for (const [token, stored] of this.#tokens) {
			if (stored.expiresAt < now || stored.revoked) {
				this.#deviceTokens.delete(`${stored.userId}:${stored.deviceId}`);
				this.#tokens.delete(token);

				const userTokens = this.#userTokens.get(stored.userId);
				if (userTokens) {
					userTokens.delete(token);
					if (userTokens.size === 0) {
						this.#userTokens.delete(stored.userId);
					}
				}
			}
		}
	}
}
