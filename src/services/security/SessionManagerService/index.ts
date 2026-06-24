import { createHash, randomBytes } from "node:crypto";
import { BaseService } from "../../BaseService.js";
import type IdentityManagerService from "../../core/IdentityManagerService/index.js";
import type { IJWTProviderMultiKey } from "../../../providers/security/jwt/types.d.ts";
import type RedisProvider from "../../../providers/queue/redis/index.js";
import type { ISessionVerifier } from "@common/types/identity/SessionVerifier.ts";
import type { AuthenticatedUser, ModerationLookupService, OAuthProviderConfig, TokenVerificationResult } from "./types.js";
export type { AuthenticatedUser, TokenVerificationResult } from "./types.js";

// Domain components
import { KeyStore } from "./domain/keys/KeyStore.js";
import { TokenService } from "./domain/tokens/TokenService.js";
import { RefreshTokenRepository } from "./domain/tokens/RefreshTokenRepository.js";
import { LoginAttemptTracker } from "./domain/security/LoginAttemptTracker.js";
import { GeoIPValidator } from "./domain/security/GeoIPValidator.js";
import { SessionManager } from "./domain/session/manager.js";
import { OAuthProviderRegistry, PlatformAuthProvider } from "./domain/oauth/index.js";
import { resolveUserAvatar } from "@common/utils/avatar.ts";

// Endpoints (singleton)
import { AuthEndpoints } from "./endpoints/auth.js";
import { OAuthEndpoints } from "./endpoints/oauth.js";

// Decoradores
import { EnableEndpoints, DisableEndpoints } from "../../core/EndpointManagerService/index.js";

/** Configuración custom del servicio (desde config.json + .env) */
interface SessionManagerConfig {
	baseUrl?: string;
	discordClientId?: string;
	discordClientSecret?: string;
	googleClientId?: string;
	googleClientSecret?: string;
}

/** Nombre de las cookies */
const ACCESS_COOKIE_NAME = "access_token";
const IS_DEV = process.env.NODE_ENV !== "production";
const PERMISSION_FINGERPRINT_TTL_SECONDS = 60;

/**
 * SessionManagerService - Orquestador de autenticación y sesiones
 *
 * Características de seguridad:
 * - Rotación automática de secretos cada 24h
 * - Access Token (JWT) con expiración de 15 minutos
 * - Refresh Token (opaco) con expiración de 30 días
 * - Detección de cambio de país por IP (Cloudflare cf-ipcountry)
 * - Rate limiting en login y refresh
 * - Bloqueo automático por intentos sospechosos
 * - Redis para estado distribuido (opcional)
 */
export default class SessionManagerService extends BaseService implements ISessionVerifier {
	public readonly name = "SessionManagerService";

	// Providers externos
	#identityService: IdentityManagerService | null = null;
	#internalIdentity: ReturnType<IdentityManagerService["_internal"]> | null = null;
	#jwtProvider: IJWTProviderMultiKey | null = null;
	#redis: RedisProvider | null = null;
	#moderation: ModerationLookupService | null = null;

	// Componentes de dominio
	#keyStore: KeyStore | null = null;
	#tokenService: TokenService | null = null;
	#refreshTokenRepo: RefreshTokenRepository | null = null;
	#loginTracker: LoginAttemptTracker | null = null;
	#geoValidator: GeoIPValidator | null = null;
	#sessionManager: SessionManager | null = null;
	#oauthRegistry: OAuthProviderRegistry | null = null;

	// Configuración
	readonly #defaultRedirectUrl = IS_DEV ? "http://localhost:3000" : "https://adigitalcafe.com";
	readonly #cookieDomain = IS_DEV ? "localhost" : ".adigitalcafe.com";

	#kernelKey?: symbol;

	/** Configuración custom interpolada desde config.json + .env */
	get #customConfig(): SessionManagerConfig {
		return (this.config?.custom || {}) as SessionManagerConfig;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ─────────────────────────────────────────────────────────────────────────────

	@EnableEndpoints({
		managers: () => [AuthEndpoints, OAuthEndpoints],
	})
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		this.#kernelKey ??= kernelKey;

		this.#jwtProvider ??= this.getMyProvider<IJWTProviderMultiKey>("security/jwt");
		this.#identityService ??= this.getMyService<IdentityManagerService>("IdentityManagerService");
		if (this.#identityService) {
			this.#internalIdentity ??= this.#identityService._internal(kernelKey);
		}

		// Redis es opcional - funciona con fallback en memoria
		try {
			this.#redis ??= this.getMyProvider<RedisProvider>("queue/redis");
		} catch {
			this.logger.logWarn("Redis no disponible, usando almacenamiento en memoria");
		}

		if (!this.#jwtProvider) throw new Error("SessionManagerService requiere jwt provider");

		// Inicializar componentes de dominio con Redis si está disponible
		await this.#initDomainComponents();

		this.logger.logOk(`SessionManagerService iniciado${this.#redis ? " con Redis" : ""}`);
	}

	async #initDomainComponents(): Promise<void> {
		// KeyStore con rotación de 24h
		this.#keyStore = new KeyStore({
			rotationInterval: 24 * 60 * 60 * 1000,
			keyLength: 32,
			initialKeys: {
				current: randomBytes(32).toString("base64"),
				previous: undefined,
			},
			redis: this.#redis || undefined,
		});

		await this.#keyStore.init();
		this.#keyStore.onRotation((keys) => {
			this.logger.logInfo(`Claves rotadas. Nueva clave activa desde ${new Date(keys.rotatedAt).toISOString()}`);
		});
		this.#keyStore.startRotation();

		// RefreshTokenRepository (30 días)
		this.#refreshTokenRepo = new RefreshTokenRepository(30 * 24 * 60 * 60, this.#redis || undefined);

		// TokenService
		this.#tokenService = new TokenService(this.#keyStore, this.#jwtProvider!, this.#refreshTokenRepo, {
			accessTokenTtl: "15m",
			refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
			cookieDomain: this.#cookieDomain,
		});

		// LoginAttemptTracker
		this.#loginTracker = new LoginAttemptTracker(this.#redis || undefined);
		this.#loginTracker.setCallbacks(
			async (userId, blocked) => {
				this.logger.logWarn(`Usuario ${userId} bloqueado: ${blocked}`);
			},
			async (userId, reason) => {
				this.logger.logWarn(`Alerta de seguridad para ${userId}: ${reason}`);
			}
		);

		// GeoIPValidator (simplificado - usa Cloudflare headers)
		this.#geoValidator = new GeoIPValidator();

		// SessionManager (para state OAuth)
		const isProd = process.env.NODE_ENV === "production";
		this.#sessionManager = new SessionManager({
			jwtProvider: this.#jwtProvider!,
			cookieConfig: {
				name: ACCESS_COOKIE_NAME,
				httpOnly: true,
				secure: isProd,
				sameSite: "lax",
				path: "/",
				maxAge: 15 * 60,
			},
			stateExpiration: 10 * 60 * 1000,
		});

		// OAuth providers
		this.#oauthRegistry = new OAuthProviderRegistry();
		this.#oauthRegistry.register(
			new PlatformAuthProvider(async (username, password) => {
				return this.#validatePlatformCredentials(username, password);
			})
		);

		// Inicializar singletons de endpoints
		try {
			if (!this.#moderation) {
				const mod = this.getMyService<import("../ModerationService/index.js").default>("ModerationService");
				this.#moderation = mod._internal(this.#kernelKey!);
			}
		} catch {
			this.#moderation = null;
		}

		AuthEndpoints.init(
			{
				keyStore: this.#keyStore,
				tokenService: this.#tokenService,
				refreshTokenRepo: this.#refreshTokenRepo,
				loginTracker: this.#loginTracker,
				geoValidator: this.#geoValidator,
				identityService: this.#identityService,
				internalIdentity: this.#internalIdentity,
				cookieDomain: this.#cookieDomain,
				defaultRedirectUrl: this.#defaultRedirectUrl,
				logger: this.logger,
				moderation: this.#moderation,
				onLoginSuccess: (userId: string, ip: string) => void this.checkAndNotifyNewLoginIp(userId, ip),
			},
			(username: string, password: string) => this.#validatePlatformCredentials(username, password)
		);

		OAuthEndpoints.init({
			tokenService: this.#tokenService,
			geoValidator: this.#geoValidator,
			sessionManager: this.#sessionManager,
			oauthRegistry: this.#oauthRegistry,
			identityService: this.#identityService,
			internalIdentity: this.#internalIdentity,
			redis: this.#redis,
			cookieDomain: this.#cookieDomain,
			defaultRedirectUrl: this.#defaultRedirectUrl,
			getProviderConfig: (provider: string) => this.#getProviderConfig(provider),
			logger: this.logger,
			moderation: this.#moderation,
		});
	}

	async verifyToken(token: string): Promise<TokenVerificationResult> {
		if (!this.#tokenService) {
			return { valid: false, error: "SessionManagerService no inicializado" };
		}

		const result = await this.#tokenService.verifyAccessToken(token);
		if (process.env.NODE_ENV !== "production") {
			this.logger.logDebug(
				`[verifyToken] valid=${result.valid} user=${result.session?.user.id || "-"} org=${result.session?.user.orgId || "-"} perms=${result.session?.user.permissions?.length || 0}`
			);
		}

		if (result.valid && result.session && this.#identityService) {
			const tokenFingerprint = this.#hashPermissions(result.session.user.permissions || []);
			const currentPermissions = await this.#getCurrentPermissionStrings(result.session.user.id, result.session.user.orgId);
			const currentFingerprint = currentPermissions ? this.#hashPermissions(currentPermissions) : null;

			if (process.env.NODE_ENV !== "production") {
				this.logger.logDebug(
					`[verifyToken] compare user=${result.session.user.id} org=${result.session.user.orgId || "-"} tokenFp=${tokenFingerprint.slice(0, 8)} currentFp=${currentFingerprint?.slice(0, 8) || "-"} currentPerms=${currentPermissions?.length || 0}`
				);
			}

			if (currentFingerprint && currentFingerprint !== tokenFingerprint) {
				result.session.user.permissions = currentPermissions || [];
				if (process.env.NODE_ENV !== "production") {
					this.logger.logWarn(
						`[verifyToken] permissions refreshed for user=${result.session.user.id} org=${result.session.user.orgId || "-"}`
					);
				}
			}
		}

		return {
			valid: result.valid,
			session: result.session,
			error: result.error,
			usedPreviousKey: result.usedPreviousKey,
		};
	}

	#hashPermissions(permissions: string[]): string {
		return createHash("sha256")
			.update([...permissions].sort((left, right) => left.localeCompare(right)).join("|"))
			.digest("hex");
	}

	async #getCurrentPermissionStrings(userId: string, orgId?: string): Promise<string[] | null> {
		if (!this.#identityService) return null;

		const cacheKey = `session:permfp:${userId}:${orgId || "global"}`;
		if (this.#redis) {
			try {
				const cached = await this.#redis.get(cacheKey);
				if (cached) return JSON.parse(cached) as string[];
			} catch {
				/* cache best-effort */
			}
		}

		try {
			const resolved = await this.#identityService.permissions.resolvePermissions(userId, orgId);
			const permissionStrings = resolved.map((permission) => `${permission.resource}.${permission.scope}.${permission.action}`);

			if (this.#redis) {
				try {
					await this.#redis.set(cacheKey, JSON.stringify(permissionStrings), PERMISSION_FINGERPRINT_TTL_SECONDS);
				} catch {
					/* cache best-effort */
				}
			}

			return permissionStrings;
		} catch {
			return null;
		}
	}

	/**
	 * Login programático - Solo para servicios del kernel
	 *
	 * Permite autenticar un usuario sin pasar por HTTP.
	 * Requiere kernelKey para prevenir uso no autorizado.
	 *
	 * @returns Token de acceso válido o null si las credenciales son inválidas
	 */
	async loginProgrammatic(kernelKey: symbol, username: string, password: string): Promise<string | null> {
		// Verificar que es una llamada autorizada del kernel
		if (this.#kernelKey !== kernelKey) {
			throw new Error("Acceso denegado: kernelKey inválido");
		}

		if (!this.#tokenService || !this.#keyStore || !this.#jwtProvider) {
			throw new Error("SessionManagerService no está inicializado");
		}

		// Validar credenciales
		const profile = await this.#validatePlatformCredentials(username, password);
		if (!profile || ("wrongPassword" in profile && profile.wrongPassword) || ("isActive" in profile && !profile.isActive)) {
			return null;
		}

		// Obtener usuario existente con permisos (si las credenciales son válidas, el usuario ya existe)
		const user = await this.#getUserById(profile.id as string);
		if (!user) {
			return null;
		}

		// Crear token
		const currentKey = this.#keyStore.getCurrentKeyBytes();
		const payload = {
			userId: user.id,
			permissions: user.permissions,
			deviceId: `kernel_${Date.now()}`,
			metadata: {
				provider: user.provider,
				username: user.username,
				email: user.email,
				avatar: user.avatar,
				orgId: user.orgId,
			},
		};

		return this.#jwtProvider.encryptWithKey(payload, currentKey, "15m");
	}

	extractSessionToken(req: { cookies?: Record<string, string> }): string | null {
		return req.cookies?.[ACCESS_COOKIE_NAME] || null;
	}

	/**
	 * Detecta un inicio de sesión desde una **IP no vista antes** (set de IPs conocidas
	 * en Redis) y notifica al usuario (`security.new_login`, inApp + email). NO notifica
	 * en el primer login conocido (set vacío) para no avisar al registrarse/primera vez.
	 * Best-effort: si no hay Redis o falla, no rompe el login.
	 */
	async checkAndNotifyNewLoginIp(userId: string, ip: string): Promise<void> {
		if (!this.#redis || !userId || !ip) return;
		const key = `notif:knownips:${userId}`;
		try {
			const known = await this.#redis.smembers(key);
			if (known.includes(ip)) return;
			await this.#redis.sadd(key, ip);
			await this.#redis.expire(key, 180 * 24 * 60 * 60); // 180 días
			if (known.length === 0) return; // primer login: registrar la IP sin avisar
			await this.emitNotification({
				userId,
				topic: "security.new_login",
				title: "Nuevo inicio de sesión",
				body: `Se detectó un inicio de sesión desde una IP diferente (${ip}). Si no fuiste vos, cambiá tu contraseña.`,
				channels: ["inApp", "email"],
				linkApp: "my-account",
				link: "/settings/privacy-security",
				data: { ip },
			});
		} catch (e) {
			this.logger.logWarn(`Chequeo de nuevo inicio de sesión falló para ${userId}: ${(e as Error).message}`);
		}
	}

	#getProviderConfig(provider: string): OAuthProviderConfig | null {
		const cfg = this.#customConfig;
		const baseUrl = cfg.baseUrl || "http://localhost:3000";

		const configs: Record<string, OAuthProviderConfig> = {
			discord: {
				clientId: this.config.private?.discordClientId || "",
				clientSecret: this.config.private?.discordClientSecret || "",
				redirectUri: `${baseUrl}/api/auth/callback/discord`,
				scopes: ["identify", "email", "guilds.members.read"],
			},
			google: {
				clientId: this.config.private?.googleClientId || "",
				clientSecret: this.config.private?.googleClientSecret || "",
				redirectUri: `${baseUrl}/api/auth/callback/google`,
				scopes: ["openid", "email", "profile"],
			},
			platform: {
				clientId: "platform",
				clientSecret: "",
				redirectUri: `${baseUrl}/api/auth/callback/platform`,
				scopes: [],
			},
		};

		return configs[provider] || null;
	}

	async #getUserById(userId: string): Promise<AuthenticatedUser | null> {
		if (!this.#internalIdentity) return null;

		try {
			const user = await this.#internalIdentity.users.getUser(userId);
			if (!user) return null;

			const avatar = resolveUserAvatar(user);

			const permissions = await this.#getUserPermissions(userId);
			return {
				id: user.id,
				provider: (user.metadata?.createdVia as string) || "platform",
				username: user.username,
				email: user.email,
				avatar,
				permissions,
				metadata: user.metadata,
			};
		} catch {
			return null;
		}
	}

	async #getUserPermissions(userId: string): Promise<string[]> {
		if (!this.#identityService) return ["public.read"];

		try {
			const permissions = this.#identityService.permissions;
			const resolved = await permissions.resolvePermissions(userId);
			return resolved.map((p: { resource: string; scope: number; action: number }) => `${p.resource}.${p.scope}.${p.action}`);
		} catch {
			return ["public.read"];
		}
	}

	async #validatePlatformCredentials(username: string, password: string) {
		// `authenticate` es primitiva pre-auth: sólo en la superficie `_internal(kernelKey)`.
		if (!this.#internalIdentity) return null;
		return this.#internalIdentity.users.authenticate(username, password);
	}

	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);

		this.#keyStore?.stopRotation();
		this.#refreshTokenRepo?.stop();
		this.#loginTracker?.stop();

		this.#keyStore = null;
		this.#tokenService = null;
		this.#refreshTokenRepo = null;
		this.#loginTracker = null;
		this.#geoValidator = null;
		this.#sessionManager = null;
		this.#oauthRegistry = null;
		this.#internalIdentity = null;

		this.logger.logDebug("SessionManagerService detenido");
	}
}
