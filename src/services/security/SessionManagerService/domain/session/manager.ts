import { randomBytes } from "node:crypto";
import type { SessionData, AuthenticatedUser, SessionCookieConfig, TokenVerificationResult } from "../../types.js";
import type { IJWTProvider, TokenPayload } from "@interfaces/modules/providers/IJWT.js";

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

	// Cache de states pendientes (en producción usar Redis)
	readonly #pendingStates = new Map<string, StoredState>();

	constructor(config: SessionManagerConfig) {
		this.#jwtProvider = config.jwtProvider;
		this.#cookieConfig = config.cookieConfig;
		this.#stateExpiration = config.stateExpiration;

		// Limpiar states expirados cada minuto
		setInterval(() => this.#cleanupExpiredStates(), 60000);
	}

	/**
	 * Genera un nuevo state para OAuth
	 */
	generateState(): string {
		const state = randomBytes(32).toString("hex");
		const now = Date.now();

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
	validateState(state: string, cookieState: string): boolean {
		// Verificar que coinciden
		if (state !== cookieState) {
			return false;
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

		// Consumir el state (one-time use)
		this.#pendingStates.delete(state);
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
