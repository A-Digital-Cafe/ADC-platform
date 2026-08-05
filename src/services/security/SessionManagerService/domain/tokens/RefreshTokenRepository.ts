import { randomBytes } from "node:crypto";
import { createAtRestSealer, type EnvelopeLogger } from "@common/utils/at-rest-envelope.ts";
import { sha256Hex } from "@common/utils/crypto.ts";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { storedRefreshTokenCheck, type StoredRefreshToken } from "../../schemas/refresh-token.js";
import type RedisProvider from "../../../../../providers/queue/redis/index.js";

export type { StoredRefreshToken };

/**
 * Sellado en reposo del registro de un refresh token.
 *
 * Un refresh token es una credencial de larga vida (30 días): quien lo tenga renueva sesiones
 * de su dueño hasta que alguien lo revoque, y el Redis que lo persiste no tiene auth.
 *
 * Cifrar el registro no alcanza por sí solo: con el valor del token en el nombre de la clave,
 * un simple `SCAN` los enumera sin descifrar nada. Por eso el índice es `sha256(token)` —un
 * id, no un secreto— y el valor va cifrado: recuperar el token desde Redis exige invertir un
 * SHA-256 *y* tener la master key.
 */
const refreshSeal = createAtRestSealer("adc:refresh-token");

/** Prefijos de claves Redis */
const REDIS_PREFIX = {
	TOKEN: "refresh:token:",
	USER: "refresh:user:",
	DEVICE: "refresh:device:",
} as const;

/**
 * Ventana de gracia de la rotación, en segundos.
 *
 * La rotación es de un solo uso, pero el cliente es multi-pestaña y multi-origen
 * (cada app federada vive en su propio origen, así que `BroadcastChannel`/`Web Locks`
 * no las coordinan entre sí): dos renovaciones simultáneas son inevitables. Durante
 * esta ventana, presentar el token ya rotado devuelve el par vigente en lugar de
 * fallar. Pasada la ventana, el reuso vuelve a ser señal de robo.
 */
const GRACE_SECONDS = 60;

/** Saltos máximos de la cadena de reemplazos (A→B→C) al resolver dentro de la gracia. */
const MAX_GRACE_HOPS = 3;

/**
 * Id de almacenamiento de un token: su SHA-256. No es un secreto —no sirve para autenticarse—
 * así que puede viajar en nombres de clave, sets e índices sin exponer la credencial.
 */
function tokenId(token: string): string {
	return sha256Hex(token);
}

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
 *
 * Cada índice (claves, set por usuario, clave por dispositivo, `replacedBy`) usa el **id** del
 * token; el valor sólo vive dentro del registro cifrado y en la cookie del cliente.
 */
export class RefreshTokenRepository {
	readonly #redis: RedisProvider | null = null;
	readonly #defaultTtl: number;
	readonly #logger: EnvelopeLogger | undefined;

	// Fallback en memoria (también indexado por id)
	readonly #tokens = new Map<string, StoredRefreshToken>();
	readonly #userTokens = new Map<string, Set<string>>();
	readonly #deviceTokens = new Map<string, string>();
	#cleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(defaultTtlSeconds: number = 30 * 24 * 60 * 60, redis?: RedisProvider, logger?: EnvelopeLogger) {
		this.#defaultTtl = defaultTtlSeconds;
		this.#redis = redis || null;
		this.#logger = logger;

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
		const id = tokenId(token);
		const now = Date.now();
		const ttl = options.ttlSeconds || this.#defaultTtl;
		const deviceKey = `${options.userId}:${options.deviceId}`;

		// Revocar token anterior del mismo dispositivo
		const existingId = this.#redis ? await this.#redis.get(`${REDIS_PREFIX.DEVICE}${deviceKey}`) : this.#deviceTokens.get(deviceKey);
		if (existingId) await this.#revokeById(existingId);

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
			const userKey = `${REDIS_PREFIX.USER}${options.userId}`;
			await Promise.all([
				this.#redis.setex(`${REDIS_PREFIX.TOKEN}${id}`, ttl, this.#seal(storedToken)),
				this.#redis.setex(`${REDIS_PREFIX.DEVICE}${deviceKey}`, ttl, id),
				this.#redis.sadd(userKey, id),
			]);
			// El SET no hereda el TTL de sus miembros: sin esto sobrevive a todos sus tokens y
			// queda para siempre, uno por usuario que alguna vez entró. Se reextiende en cada
			// login, así que dura lo que el token más nuevo.
			await this.#redis.expire(userKey, ttl);
		} else {
			this.#tokens.set(id, storedToken);
			this.#deviceTokens.set(deviceKey, id);
			if (!this.#userTokens.has(options.userId)) {
				this.#userTokens.set(options.userId, new Set());
			}
			this.#userTokens.get(options.userId)!.add(id);
		}

		return storedToken;
	}

	/**
	 * Busca un refresh token por valor
	 */
	async findByToken(token: string): Promise<StoredRefreshToken | null> {
		return this.#findById(tokenId(token));
	}

	/**
	 * Resuelve el refresh token vigente para el que presenta el cliente: el propio si
	 * sigue vivo, o su reemplazo si fue rotado hace menos de `GRACE_SECONDS`.
	 *
	 * `replayed` distingue "renovación normal" de "llegué tarde a una rotación que ya
	 * hizo otra pestaña". El caller NO debe volver a rotar en el segundo caso ni
	 * contarlo como intento fallido: no es un reuso fraudulento.
	 */
	async resolveCurrent(token: string): Promise<{ stored: StoredRefreshToken; replayed: boolean } | null> {
		const alive = await this.findByToken(token);
		if (alive) return { stored: alive, replayed: false };

		// Cadena de reemplazos: con varias pestañas pueden encadenarse A→B→C dentro
		// de la misma ventana; el que presenta A debe llegar igual al vigente.
		let currentId = tokenId(token);
		for (let hop = 0; hop < MAX_GRACE_HOPS; hop++) {
			const raw = await this.#readRaw(currentId);
			if (!raw?.replacedBy || raw.replacedAt === undefined) return null;
			if (Date.now() - raw.replacedAt > GRACE_SECONDS * 1000) return null;

			const replacement = await this.#findById(raw.replacedBy);
			if (replacement) return { stored: replacement, replayed: true };
			currentId = raw.replacedBy;
		}

		return null;
	}

	/**
	 * ¿El token presentado es el REUSO de uno ya rotado, más allá de la ventana de gracia?
	 * Es la señal canónica de robo (OAuth 2.0 Security BCP §4.14.2): devuelve el `userId` para
	 * revocar toda su familia. Un token nunca visto o simplemente expirado devuelve `null` (un
	 * 401 normal, no un incidente de seguridad). Ver ADC-04.
	 */
	async detectReplayedToken(token: string): Promise<{ userId: string } | null> {
		const raw = await this.#readRaw(tokenId(token));
		if (raw?.replacedBy && raw.replacedAt !== undefined && Date.now() - raw.replacedAt > GRACE_SECONDS * 1000) {
			return { userId: raw.userId };
		}
		return null;
	}

	/**
	 * Busca un refresh token por usuario y dispositivo
	 */
	async findByUserAndDevice(userId: string, deviceId: string): Promise<StoredRefreshToken | null> {
		const deviceKey = `${userId}:${deviceId}`;
		const id = this.#redis ? await this.#redis.get(`${REDIS_PREFIX.DEVICE}${deviceKey}`) : this.#deviceTokens.get(deviceKey);
		if (!id) return null;
		return this.#findById(id);
	}

	/**
	 * Revoca un token específico
	 */
	async revoke(token: string): Promise<boolean> {
		return this.#revokeById(tokenId(token));
	}

	/**
	 * Revoca la sesión de un dispositivo concreto sin necesidad del valor del token.
	 *
	 * Es lo que necesita cerrar sesión: el servidor conoce al usuario y el dispositivo (van
	 * dentro del access token), pero no el refresh token —su cookie está acotada a la ruta de
	 * refresh—. Resuelve por el índice de dispositivo, que ya guarda el id.
	 */
	async revokeForDevice(userId: string, deviceId: string): Promise<boolean> {
		const deviceKey = `${userId}:${deviceId}`;
		const id = this.#redis ? await this.#redis.get(`${REDIS_PREFIX.DEVICE}${deviceKey}`) : this.#deviceTokens.get(deviceKey);
		if (!id) return false;
		return this.#revokeById(id);
	}

	/**
	 * Lista los refresh tokens ACTIVOS de un usuario (sesiones vivas por dispositivo).
	 * No expone el valor del token: el caller debe proyectar sólo metadatos.
	 */
	async listForUser(userId: string): Promise<StoredRefreshToken[]> {
		if (this.#redis) {
			const ids = await this.#liveIdsForUser(userId);
			const stored = await Promise.all(ids.map((id) => this.#findById(id)));
			return stored.filter((s): s is StoredRefreshToken => s !== null);
		}

		const userTokens = this.#userTokens.get(userId);
		if (!userTokens) return [];
		const now = Date.now();
		const result: StoredRefreshToken[] = [];
		for (const id of userTokens) {
			const stored = this.#tokens.get(id);
			if (stored && !stored.revoked && stored.expiresAt > now) result.push(stored);
		}
		return result;
	}

	/**
	 * Revoca todos los tokens de un usuario
	 */
	async revokeAllForUser(userId: string): Promise<number> {
		if (this.#redis) {
			const ids = await this.#liveIdsForUser(userId);
			if (ids.length === 0) return 0;

			let count = 0;
			for (const id of ids) {
				if (await this.#revokeById(id)) count++;
			}
			return count;
		}

		const userTokens = this.#userTokens.get(userId);
		if (!userTokens) return 0;

		let count = 0;
		for (const id of userTokens) {
			const stored = this.#tokens.get(id);
			if (stored && !stored.revoked) {
				stored.revoked = true;
				this.#deviceTokens.delete(`${stored.userId}:${stored.deviceId}`);
				count++;
			}
		}
		return count;
	}

	/**
	 * Rota un refresh token (revoca el viejo, crea uno nuevo) dejando el viejo
	 * apuntando al nuevo durante `GRACE_SECONDS` (ver `resolveCurrent`).
	 */
	async rotate(oldToken: string, options: Omit<CreateRefreshTokenOptions, "userId" | "deviceId">): Promise<StoredRefreshToken | null> {
		const existing = await this.findByToken(oldToken);
		if (!existing) return null;

		// El orden importa: `revoke` limpia la clave de dispositivo y `create` la
		// reapunta al token nuevo. Invertirlo dejaría el dispositivo sin token vivo.
		await this.revoke(oldToken);

		const created = await this.create({
			userId: existing.userId,
			deviceId: existing.deviceId,
			...options,
		});

		await this.#linkReplacement(tokenId(oldToken), tokenId(created.token));
		return created;
	}

	/** Registro vivo (no revocado, no expirado) por id, o `null`. */
	/**
	 * Ids del índice de un usuario, podando de paso los que ya no tienen registro.
	 *
	 * Cuando un refresh vence, Redis borra su clave pero el id sobrevive en el SET: sin esta
	 * poda el índice acumula una entrada por cada sesión histórica y no lo limpia nadie (el
	 * `srem` sólo corre en la revocación explícita, y `#cleanupExpired` es del camino en
	 * memoria). Se usa `exists` en vez de leer el registro para no descifrar de más.
	 */
	async #liveIdsForUser(userId: string): Promise<string[]> {
		if (!this.#redis) return [];
		const userKey = `${REDIS_PREFIX.USER}${userId}`;
		const ids = await this.#redis.smembers(userKey);
		const checked = await Promise.all(
			ids.map(async (id) => ({ id, alive: await this.#redis!.exists(`${REDIS_PREFIX.TOKEN}${id}`) }))
		);
		const dead = checked.filter((entry) => !entry.alive).map((entry) => entry.id);
		if (dead.length > 0) await this.#redis.srem(userKey, ...dead);
		return checked.filter((entry) => entry.alive).map((entry) => entry.id);
	}

	async #findById(id: string): Promise<StoredRefreshToken | null> {
		const stored = await this.#readRaw(id);
		if (!stored || stored.revoked || Date.now() > stored.expiresAt) return null;
		return stored;
	}

	/** Revoca por id. Es la operación real: `revoke(token)` sólo resuelve el id primero. */
	async #revokeById(id: string): Promise<boolean> {
		if (this.#redis) {
			const stored = await this.#readRaw(id);
			if (!stored) return false;

			stored.revoked = true;

			await Promise.all([
				// Mantener 1 min para evitar reuso.
				this.#redis.set(`${REDIS_PREFIX.TOKEN}${id}`, this.#seal(stored), 60),
				this.#redis.del(`${REDIS_PREFIX.DEVICE}${stored.userId}:${stored.deviceId}`),
				this.#redis.srem(`${REDIS_PREFIX.USER}${stored.userId}`, id),
			]);
			return true;
		}

		const stored = this.#tokens.get(id);
		if (!stored) return false;

		stored.revoked = true;
		this.#deviceTokens.delete(`${stored.userId}:${stored.deviceId}`);
		return true;
	}

	/**
	 * Lee el registro crudo por id, incluidos los revocados/expirados: `resolveCurrent`
	 * necesita ver el token ya rotado para seguir el enlace a su reemplazo.
	 */
	async #readRaw(id: string): Promise<StoredRefreshToken | null> {
		if (this.#redis) {
			const sealed = await this.#redis.get(`${REDIS_PREFIX.TOKEN}${id}`);
			// Un registro que no abre es un registro que no existe: nunca se acepta el valor
			// crudo como fallback, que es lo que permitiría plantar un token a mano en Redis.
			const plain = refreshSeal.open(sealed, this.#logger);
			return safeParseJson(plain, storedRefreshTokenCheck);
		}

		return this.#tokens.get(id) ?? null;
	}

	/**
	 * Deja el token rotado apuntando a su reemplazo. Dentro de `GRACE_SECONDS`, presentar el
	 * token viejo devuelve el par vigente (`resolveCurrent`). Pasada la gracia, el registro se
	 * conserva como *tombstone* hasta el vencimiento natural del token —no 60s— para poder
	 * DETECTAR su reuso (señal de robo) en lugar de perderlo. El corte de gracia lo hace el
	 * timestamp `replacedAt` (en `resolveCurrent`/`detectReplayedToken`), no la expiración de la
	 * clave. Ver ADC-04.
	 */
	async #linkReplacement(oldId: string, newId: string): Promise<void> {
		const stored = await this.#readRaw(oldId);
		if (!stored) return;

		stored.replacedBy = newId;
		stored.replacedAt = Date.now();

		if (this.#redis) {
			const tombstoneTtl = Math.max(GRACE_SECONDS, Math.ceil((stored.expiresAt - Date.now()) / 1000));
			await this.#redis.set(`${REDIS_PREFIX.TOKEN}${oldId}`, this.#seal(stored), tombstoneTtl);
		}
	}

	/**
	 * Elimina físicamente todos los tokens de un usuario
	 */
	async deleteAllForUser(userId: string): Promise<number> {
		if (this.#redis) {
			const ids = await this.#redis.smembers(`${REDIS_PREFIX.USER}${userId}`);
			if (ids.length === 0) return 0;

			const deletePromises = ids.map(async (id) => {
				const stored = await this.#readRaw(id);
				if (stored) {
					await this.#redis!.del(`${REDIS_PREFIX.DEVICE}${stored.userId}:${stored.deviceId}`);
				}
				await this.#redis!.del(`${REDIS_PREFIX.TOKEN}${id}`);
			});

			await Promise.all(deletePromises);
			await this.#redis.del(`${REDIS_PREFIX.USER}${userId}`);
			return ids.length;
		}

		const userTokens = this.#userTokens.get(userId);
		if (!userTokens) return 0;

		let count = 0;
		for (const id of userTokens) {
			const stored = this.#tokens.get(id);
			if (stored) {
				this.#deviceTokens.delete(`${stored.userId}:${stored.deviceId}`);
				this.#tokens.delete(id);
				count++;
			}
		}

		this.#userTokens.delete(userId);
		return count;
	}

	#seal(stored: StoredRefreshToken): string {
		return refreshSeal.seal(JSON.stringify(stored), this.#logger);
	}

	#generateToken(): string {
		return randomBytes(48).toString("base64url");
	}

	#cleanupExpired(): void {
		const now = Date.now();

		for (const [id, stored] of this.#tokens) {
			if (stored.expiresAt < now || stored.revoked) {
				this.#deviceTokens.delete(`${stored.userId}:${stored.deviceId}`);
				this.#tokens.delete(id);

				const userTokens = this.#userTokens.get(stored.userId);
				if (userTokens) {
					userTokens.delete(id);
					if (userTokens.size === 0) {
						this.#userTokens.delete(stored.userId);
					}
				}
			}
		}
	}
}
