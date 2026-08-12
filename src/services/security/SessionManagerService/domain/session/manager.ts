import { randomBytes } from "node:crypto";
import { sha256Hex } from "@common/utils/crypto.ts";
import type { SessionData, AuthenticatedUser, SessionCookieConfig, TokenVerificationResult } from "../../types.js";
import type { IJWTProvider, TokenPayload } from "@interfaces/modules/providers/IJWT.js";
import type RedisProvider from "../../../../../providers/queue/redis/index.js";

/**
 * Prefijos de las claves del state en Redis.
 *
 * El índice es `sha256(state)` y no el state en claro, por el mismo criterio que `oauth:pending:`:
 * el Redis compartido no tiene auth, así que un `SCAN` no debe devolver states vivos de terceros.
 */
const REDIS_PREFIX = {
	STATE: "oauth:state:",
	CONSUMED: "oauth:state-consumed:",
} as const;

/**
 * Configuración del gestor de sesión
 */
interface SessionManagerConfig {
	/** Provider JWT para cifrar/descifrar tokens */
	jwtProvider: IJWTProvider;
	/** Configuración de la cookie de sesión */
	cookieConfig: SessionCookieConfig;
	/** Tiempo de expiración del state en ms */
	stateExpiration: number;
	/** Redis donde compartir el state entre nodos; sin él, sólo memoria del proceso */
	redis?: RedisProvider;
}

/**
 * State almacenado para validación CSRF
 */
interface StoredState {
	value: string;
	createdAt: number;
	expiresAt: number;
}

/**
 * SessionManager - Gestión de sesiones y tokens
 *
 * Responsabilidades:
 * - Generación y validación de state para OAuth (CSRF protection)
 * - Creación de tokens de sesión
 * - Verificación de tokens existentes
 */
export class SessionManager {
	readonly #jwtProvider: IJWTProvider;
	readonly #cookieConfig: SessionCookieConfig;
	readonly #stateExpiration: number;
	readonly #stateTtlSeconds: number;
	readonly #redis: RedisProvider | null;

	/**
	 * Respaldo en memoria: sólo se usa si NO hay Redis, y entonces el despliegue es forzosamente de
	 * un nodo. Con varios, el login y el callback del proveedor caen en procesos distintos casi la
	 * mitad de las veces, y un state por-proceso hace fallar esos logins como si fueran CSRF.
	 */
	readonly #pendingStates = new Map<string, StoredState>();
	#cleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(config: SessionManagerConfig) {
		this.#jwtProvider = config.jwtProvider;
		this.#cookieConfig = config.cookieConfig;
		this.#stateExpiration = config.stateExpiration;
		this.#stateTtlSeconds = Math.max(1, Math.ceil(config.stateExpiration / 1000));
		this.#redis = config.redis || null;

		// Barrido sólo sin Redis: allá los states caducan por TTL nativo.
		if (!this.#redis) {
			this.#cleanupTimer = setInterval(() => this.#cleanupExpiredStates(), 60000);
			this.#cleanupTimer.unref();
		}
	}

	stop(): void {
		if (this.#cleanupTimer) {
			clearInterval(this.#cleanupTimer);
			this.#cleanupTimer = null;
		}
	}

	/**
	 * Genera un nuevo state para OAuth
	 */
	async generateState(): Promise<string> {
		const state = randomBytes(32).toString("hex");
		const now = Date.now();

		if (this.#redis) {
			await this.#redis.setex(`${REDIS_PREFIX.STATE}${sha256Hex(state)}`, this.#stateTtlSeconds, String(now));
			return state;
		}

		this.#pendingStates.set(state, {
			value: state,
			createdAt: now,
			expiresAt: now + this.#stateExpiration,
		});

		return state;
	}

	/**
	 * Valida un state recibido del callback
	 */
	async validateState(state: string, cookieState: string): Promise<boolean> {
		// Verificar que coinciden
		if (state !== cookieState) {
			return false;
		}

		if (this.#redis) {
			return this.#consumeRedisState(this.#redis, state);
		}

		// Verificar que existe y no ha expirado
		const stored = this.#pendingStates.get(state);
		if (!stored) {
			return false;
		}

		if (Date.now() > stored.expiresAt) {
			this.#pendingStates.delete(state);
			return false;
		}

		// Consumir el state (one-time use). El Map vive en un solo proceso y no hay `await` entre el
		// `get` y el `delete`, así que no hay ventana para que dos callbacks lo consuman los dos.
		this.#pendingStates.delete(state);
		return true;
	}

	/**
	 * Consume el state en Redis, de un solo uso.
	 *
	 * `RedisProvider` no expone un `GETDEL` ni un `del` que devuelva cuántas claves borró, y un
	 * `exists` + `del` deja pasar a dos callbacks concurrentes: los dos ven la clave antes de que
	 * ninguno la borre. Quien decide acá es `setIfAbsent` (`SET NX EX`, una sola operación del
	 * servidor) sobre una clave aparte: de N callbacks simultáneos con el mismo state, exactamente
	 * uno la crea y sigue; el resto se va con `false`.
	 *
	 * El chequeo de emisión va ANTES del claim para que un state inventado no deje clave nueva en
	 * Redis (el callback es público y su rate limit es por cliente).
	 */
	async #consumeRedisState(redis: RedisProvider, state: string): Promise<boolean> {
		const id = sha256Hex(state);

		// Emitido por la plataforma y todavía vigente: el TTL nativo hace de `expiresAt`.
		if (!(await redis.exists(`${REDIS_PREFIX.STATE}${id}`))) {
			return false;
		}

		if (!(await redis.setIfAbsent(`${REDIS_PREFIX.CONSUMED}${id}`, "1", this.#stateTtlSeconds))) {
			return false;
		}

		await redis.del(`${REDIS_PREFIX.STATE}${id}`);
		return true;
	}

	/**
	 * Crea un token de sesión para el usuario
	 */
	async createSessionToken(user: AuthenticatedUser): Promise<string> {
		const payload: TokenPayload = {
			userId: user.id,
			permissions: user.permissions,
			metadata: {
				provider: user.provider,
				username: user.username,
				email: user.email,
				avatar: user.avatar,
				orgId: user.orgId,
			},
		};

		return this.#jwtProvider.encrypt(payload);
	}

	/**
	 * Verifica un token de sesión
	 */
	async verifyToken(token: string): Promise<TokenVerificationResult> {
		const result = await this.#jwtProvider.decrypt(token);

		if (!result.valid || !result.payload) {
			return {
				valid: false,
				error: result.error || "Token inválido",
			};
		}

		const session: SessionData = {
			user: {
				id: result.payload.userId,
				provider: (result.payload.metadata?.provider as string) || "platform",
				username: (result.payload.metadata?.username as string) || "unknown",
				email: result.payload.metadata?.email as string | undefined,
				avatar: result.payload.metadata?.avatar as string | undefined,
				permissions: result.payload.permissions,
				orgId: result.payload.metadata?.orgId as string | undefined,
			},
			createdAt: (result.payload.iat || 0) * 1000,
			expiresAt: (result.payload.exp || 0) * 1000,
		};

		return {
			valid: true,
			session,
		};
	}

	/**
	 * Obtiene la configuración de la cookie de sesión
	 */
	getCookieConfig(): SessionCookieConfig {
		return { ...this.#cookieConfig };
	}

	/**
	 * Obtiene el nombre de la cookie de state
	 */
	getStateCookieName(): string {
		return "oauth_state";
	}

	/**
	 * Limpia states expirados
	 */
	#cleanupExpiredStates(): void {
		const now = Date.now();
		for (const [key, stored] of this.#pendingStates) {
			if (now > stored.expiresAt) {
				this.#pendingStates.delete(key);
			}
		}
	}
}
