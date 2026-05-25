import type { FastifyRequest, FastifyReply } from "fastify";
import type { TokenVerificationResult as JWTTokenVerificationResult } from "../../../providers/security/jwt/types.d.ts";
import type { BanLookupResult } from "@common/types/identity/Moderation.js";

/**
 * Información del usuario autenticado
 */
export interface AuthenticatedUser {
	/** ID único del usuario en la plataforma */
	id: string;
	/** ID del usuario en el provider externo (si aplica) */
	providerId?: string;
	/** Provider usado para autenticar */
	provider: string;
	/** Username */
	username: string;
	/** Email (opcional) */
	email?: string;
	/** Avatar URL (opcional) */
	avatar?: string;
	/** Permisos en formato [resource].[scope].action */
	permissions: string[];
	/** Organización actual (opcional) */
	orgId?: string;
	/** Metadatos adicionales */
	metadata?: Record<string, unknown>;
	/** Si el usuario está activo (false → baneado/deshabilitado) */
	isActive?: boolean;
}

/** Subset de ModerationService usado por SessionManagerService. */
export interface ModerationLookupService {
	isEmailBanned(rawEmail: string): Promise<BanLookupResult>;
	isIpBanned(rawIp: string): Promise<BanLookupResult>;
	recordLoginAttemptIp(userId: string, rawIp: string): Promise<void>;
}

/**
 * Configuración de un proveedor OAuth
 */
export interface OAuthProviderConfig {
	/** Client ID de la aplicación */
	clientId: string;
	/** Client Secret de la aplicación */
	clientSecret: string;
	/** URL de callback (redirect_uri) */
	redirectUri: string;
	/** Scopes requeridos */
	scopes: string[];
}

/**
 * Resultado del intercambio de código por token
 */
export interface TokenExchangeResult {
	accessToken: string;
	refreshToken?: string;
	expiresIn?: number;
	tokenType: string;
}

/**
 * Interface para proveedores OAuth (Strategy Pattern)
 */
export interface IOAuthProvider {
	/** Nombre del provider */
	readonly name: string;

	/**
	 * Genera la URL de autorización para redirigir al usuario
	 */
	getAuthorizationUrl(state: string, config: OAuthProviderConfig): string;

	/**
	 * Intercambia el código de autorización por tokens
	 */
	exchangeCode(code: string, config: OAuthProviderConfig): Promise<TokenExchangeResult>;

	/**
	 * Obtiene el perfil del usuario usando el access token
	 */
	getUserProfile(accessToken: string): Promise<ProviderUserProfile>;
}

/**
 * Configuración de cookies de sesión
 */
export interface SessionCookieConfig {
	/** Nombre de la cookie */
	name: string;
	/** HttpOnly flag */
	httpOnly: boolean;
	/** Secure flag (solo HTTPS) */
	secure: boolean;
	/** SameSite policy */
	sameSite: "strict" | "lax" | "none";
	/** Path de la cookie */
	path: string;
	/** Tiempo de vida en segundos */
	maxAge: number;
	/** Dominio (opcional, para subdominios) */
	domain?: string;
}

/**
 * Datos de sesión activa
 */
export interface SessionData {
	/** Usuario autenticado */
	user: AuthenticatedUser;
	/** Timestamp de creación */
	createdAt: number;
	/** Timestamp de expiración */
	expiresAt: number;
}

/**
 * Contexto de request con tipos extendidos
 */
export interface AuthRequest extends FastifyRequest {
	params: {
		provider?: string;
	};
	query: {
		code?: string;
		state?: string;
		error?: string;
		error_description?: string;
	};
	cookies: Record<string, string>;
	headers: Record<string, string | string[] | undefined>;
	ip: string;
}

/**
 * Reply con métodos de cookie
 */
export interface AuthReply extends FastifyReply {
	setCookie(name: string, value: string, options?: Record<string, unknown>): AuthReply;
	clearCookie(name: string, options?: Record<string, unknown>): AuthReply;
	header(name: string, value: string): AuthReply;
}

/**
 * Resultado de verificación de token
 */
export interface TokenVerificationResult extends JWTTokenVerificationResult<undefined> {
	valid?: boolean;
	error?: string;
	session?: SessionData;
	/** Si se verificó con clave anterior (requiere refresh) */
	usedPreviousKey?: boolean;
}

/**
 * Par de tokens retornado en login
 */
export interface LoginTokens {
	/** Access Token (JWT) - va en cookie de sesión */
	accessToken: string;
	/** Refresh Token (opaco) - va en cookie HttpOnly con path /auth/refresh */
	refreshToken: string;
}

/**
 * Resultado de operación de login
 */
export interface LoginResult {
	success: boolean;
	tokens?: LoginTokens;
	user?: {
		id: string;
		username: string;
		email?: string;
		permissions: string[];
	};
	error?: string;
	/** Si el usuario está bloqueado */
	blocked?: boolean;
	/** Hasta cuándo está bloqueado (si es temporal) */
	blockedUntil?: number;
}

/**
 * Resultado de operación de refresh
 */
export interface RefreshResult {
	success: boolean;
	tokens?: LoginTokens;
	error?: string;
	/** Si el usuario fue bloqueado por refresh sospechoso */
	blocked?: boolean;
}

/**
 * Configuración del SessionManagerService
 */
export interface SessionManagerConfig {
	/** URL base de la plataforma */
	baseUrl: string;
	/** URL por defecto para redirección post-login */
	defaultRedirectUrl: string;
	/** Tiempo de vida del state en ms (default: 10 min) */
	stateExpiration: number;
	/** Configuración de la cookie de sesión */
	sessionCookie: SessionCookieConfig;
	/** Providers OAuth configurados */
	providers: Record<string, OAuthProviderConfig>;
	/** Dominio para cookies (para subdominios) */
	cookieDomain: string;
	/** TTL del Access Token (default: 15m) */
	accessTokenTtl: string;
	/** TTL del Refresh Token en segundos (default: 30 días) */
	refreshTokenTtlSeconds: number;
	/** Intervalo de rotación de claves en ms (default: 24h) */
	keyRotationInterval: number;
}
