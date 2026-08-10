import { createHash, randomBytes } from "node:crypto";
import { BaseService } from "../../BaseService.js";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";
import type { IdentityInternalWithDiscord } from "../../core/IdentityManagerService/internal.js";
import type { IJWTProviderMultiKey } from "@interfaces/modules/providers/IJWT.js";
import type RedisProvider from "../../../providers/queue/redis/index.js";
import type { ISessionVerifier } from "@common/types/identity/SessionVerifier.ts";
import type { ISessionManagerService } from "@common/types/identity/ISessionManagerService.ts";
import type { IModerationService } from "@common/types/identity/IModerationService.ts";
import { Scope, assertScope, type CapabilityToken } from "@common/security/Capability.ts";
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
import { LEGAL_DOCUMENTS, MIN_LEGAL_NOTICE_DAYS, currentLegalVersions, legalNoticeDays, type LegalDocument } from "@common/utils/legal-docs.js";
import { PLATFORM_TOPICS } from "@common/utils/notifications/platform-topics.js";
import { openPermissions, sealPermissions } from "./domain/security/perm-cache.js";

// Endpoints (singleton)
import { AuthEndpoints } from "./endpoints/auth.js";
import { OAuthEndpoints } from "./endpoints/oauth.js";
import { SessionAdminEndpoints, maskIp } from "./endpoints/sessions.js";
import { LegalEndpoints } from "./endpoints/legal.js";

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
 * Espera antes de chequear los documentos legales: `NotificationService` arranca después que este
 * servicio (kernelMode 80 contra 70), así que anunciar en `start()` descartaría el aviso.
 */
const LEGAL_CHECK_DELAY_MS = 30_000;

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
export default class SessionManagerService extends BaseService implements ISessionVerifier, ISessionManagerService {
	public readonly name = "SessionManagerService";

	// Providers externos
	#identityService: IIdentityManagerService | null = null;
	#internalIdentity: IdentityInternalWithDiscord | null = null;
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
	#legalCheckTimer: ReturnType<typeof setTimeout> | null = null;

	// Configuración (overrides opcionales vía config.json → private; defaults por entorno)
	get #defaultRedirectUrl(): string {
		return this.config.private?.defaultRedirectUrl || (IS_DEV ? "http://localhost:3000" : "https://adigitalcafe.com");
	}

	/**
	 * Dominio de las cookies de sesión. Por defecto "" (*host-only*): sin atributo `Domain`, sólo
	 * el host exacto que emitió la cookie la recibe.
	 *
	 * Antes producción usaba `.adigitalcafe.com`, que compartía la sesión con CUALQUIER subdominio
	 * de inquilino (`*.adigitalcafe.com`): un subdominio de bajo valor comprometido podía pivotar a
	 * la API central con la sesión del usuario (CWE-1275, ADC-05). Host-only lo evita. Un despliegue
	 * que de verdad necesite SSO entre subdominios debe habilitarlo de forma EXPLÍCITA vía
	 * `private.cookieDomain` (p. ej. ".adigitalcafe.com"), asumiendo ese riesgo. En dev "" también
	 * es lo correcto: vale en `localhost` y entrando por la IP de LAN.
	 */
	get #cookieDomain(): string {
		return this.config.private?.cookieDomain || "";
	}

	/** Configuración custom interpolada desde config.json + .env */
	get #customConfig(): SessionManagerConfig {
		return (this.config?.custom || {}) as SessionManagerConfig;
	}

	// Lifecycle

	@EnableEndpoints({
		managers: () => [AuthEndpoints, OAuthEndpoints, SessionAdminEndpoints, LegalEndpoints],
	})
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		this.#jwtProvider ??= this.getMyProvider<IJWTProviderMultiKey>("security/jwt");
		this.#identityService ??= this.getMyService<IIdentityManagerService>("IdentityManagerService");
		if (this.#identityService) {
			// SessionManager necesita la superficie combinada (users/roles para auth + discord
			// para el sync de roles): declara `identity:internal` e `identity:discord`.
			this.#internalIdentity ??= {
				...this.#identityService._internal(this.getCapability()),
				...this.#identityService._internalDiscord(this.getCapability()),
			};
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

		this.#legalCheckTimer = setTimeout(() => void this.#checkLegalDocsVersion(), LEGAL_CHECK_DELAY_MS);
	}

	/**
	 * Detecta el despliegue de una versión nueva de CUALQUIER documento legal versionado y la
	 * anuncia. Este servicio es el que valida la aceptación, así que es el que sabe qué versión está
	 * vigente; el aviso existe para que publicar el documento y comunicarlo no dependan de
	 * acordarse. Los informativos (cookies, DPA) entran igual —Privacidad §7 y DPA §15 prometen el
	 * mismo preaviso de ≥{@link MIN_LEGAL_NOTICE_DAYS} días—, sólo que sin exigir re-aceptación.
	 *
	 * La marca de "ya avisado" vive en Redis y no en Mongo a propósito: no vale un modelo nuevo
	 * para un par de strings, y el peor caso de perder la clave es un aviso repetido —que para un
	 * cambio legal es el lado seguro del error—. Sin Redis, no avisa: best-effort, nunca rompe el
	 * arranque.
	 */
	async #checkLegalDocsVersion(): Promise<void> {
		if (!this.#redis || !this.#identityService) return;
		const docs: readonly LegalDocument[] = Object.values(LEGAL_DOCUMENTS);
		const current: Record<string, string> = Object.fromEntries(docs.map((doc) => [doc.id, doc.version]));
		try {
			const key = "legal:announced-versions";
			const raw = await this.#redis.get(key);
			// La clave la escribe sólo este método, así que un JSON.parse directo alcanza: si viniera
			// corrupta, el catch de abajo la trata como "no avisar" y el siguiente arranque la resella.
			const previous = raw ? this.#parseAnnouncedVersions(raw) : null;

			// Primer arranque con la clave vacía: sellar sin avisar. Si no, cada Redis nuevo
			// dispararía una alerta por un cambio que no ocurrió.
			if (!previous || Object.keys(previous).length === 0) {
				await this.#redis.set(key, JSON.stringify(current));
				return;
			}

			// Un documento visto por primera vez se sella sin anunciar, igual que el primer arranque:
			// sólo anuncia un CAMBIO de versión respecto de lo ya sellado.
			const changed = docs.filter((doc) => previous[doc.id] && previous[doc.id] !== doc.version);
			if (changed.length === 0) {
				if (raw !== JSON.stringify(current)) await this.#redis.set(key, JSON.stringify(current));
				return;
			}

			// Sellar sólo si el aviso salió: si se descartó, el próximo arranque lo reintenta. Un
			// aviso repetido lo deduplica `NotificationService`; uno perdido no lo recupera nadie.
			if (await this.#announceLegalDocs(changed)) await this.#redis.set(key, JSON.stringify(current));
			else this.logger.logWarn("[SessionManager] Cambio de documentos legales sin anunciar: se reintenta en el próximo arranque");
		} catch (err: any) {
			this.logger.logWarn(`Chequeo de versión de documentos legales falló: ${err?.message || err}`);
		}
	}

	/**
	 * Versiones ya anunciadas, tolerando el formato viejo (`{termsVersion, privacyVersion}`): sin
	 * esta compatibilidad, el primer arranque tras ampliar el anunciador trataría a terms/privacy
	 * como "nunca vistos" y sellaría sin detectar un cambio desplegado en esa misma ventana.
	 */
	#parseAnnouncedVersions(raw: string): Record<string, string> {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const out: Record<string, string> = {};
		if (typeof parsed.termsVersion === "string") out.terms = parsed.termsVersion;
		if (typeof parsed.privacyVersion === "string") out.privacy = parsed.privacyVersion;
		for (const [id, version] of Object.entries(parsed)) {
			if (typeof version === "string" && id in LEGAL_DOCUMENTS) out[id] = version;
		}
		return out;
	}

	/**
	 * Anuncia el cambio a TODAS las personas usuarias (`platform.legal`, canal in-app no
	 * silenciable) y al equipo. El aviso sale al desplegar la versión nueva y dice desde cuándo
	 * rige: eso es lo que hace cierto el preaviso de los Términos, porque la re-aceptación no se
	 * pide hasta `effectiveFrom`. Un `effectiveFrom` demasiado cerca de la publicación deja el
	 * compromiso incumplido, así que se loguea como error en vez de pasar en silencio.
	 *
	 * `broadcastId` es determinista (documento + versión) y no un UUID: si el aviso se reintenta
	 * —clave de Redis perdida, redeploy— el dedup de `NotificationService` evita la doble entrega.
	 *
	 * @returns `false` si el anuncio a las personas usuarias se descartó (sin subsistema de
	 * notificaciones): el caller no debe dar el cambio por avisado.
	 */
	async #announceLegalDocs(changed: LegalDocument[]): Promise<boolean> {
		for (const doc of changed) {
			const days = legalNoticeDays(doc);
			if (days < MIN_LEGAL_NOTICE_DAYS) {
				this.logger.logError(
					`[SessionManager] ${doc.label} ${doc.version} rige desde ${doc.effectiveFrom}: ${days} día(s) de preaviso, menos de los ${MIN_LEGAL_NOTICE_DAYS} comprometidos en los Términos`
				);
			}
		}

		const detail = changed.map((doc) => `${doc.label} (rige desde el ${doc.effectiveFrom})`).join(" y ");
		// Los informativos se anuncian igual, pero sin prometer una re-aceptación que nunca se pide.
		const requiresAcceptance = changed.some((doc) => doc.requiresAcceptance);
		const mode = await this.emitBroadcast({
			broadcastId: `legal:${changed.map((doc) => `${doc.id}@${doc.version}`).join("+")}`,
			topic: PLATFORM_TOPICS.legal.topic,
			title: "Actualizamos nuestros documentos legales",
			body: requiresAcceptance
				? `Cambió: ${detail}. Podés leer el texto nuevo ahora; a partir de esa fecha te vamos a pedir que lo aceptes para seguir usando la plataforma.`
				: `Cambió: ${detail}. Podés leer el texto nuevo ahora; rige desde esa fecha, sin necesidad de volver a aceptar nada.`,
			link: changed[0].href,
			// Ruta de la app `help`: que la resuelva el cliente según entorno en vez de clavar un dominio.
			linkApp: "help",
			data: { changed: changed.map((doc) => ({ id: doc.id, version: doc.version, effectiveFrom: doc.effectiveFrom })) },
		});

		await this.#identityService?.notifications(this.getCapability()).legalDocsUpdated({
			changed: changed.map((doc) => doc.label),
			...currentLegalVersions(),
		});
		this.logger.logInfo(`[SessionManager] Documentos legales actualizados (${changed.map((doc) => doc.label).join(", ")}): anuncio ${mode}`);
		return mode !== "dropped";
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
			logger: this.logger,
		});

		await this.#keyStore.init();
		this.#keyStore.onRotation((keys) => {
			this.logger.logInfo(`Claves rotadas. Nueva clave activa desde ${new Date(keys.rotatedAt).toISOString()}`);
		});
		this.#keyStore.startRotation();

		// RefreshTokenRepository (30 días)
		this.#refreshTokenRepo = new RefreshTokenRepository(30 * 24 * 60 * 60, this.#redis || undefined, this.logger);

		this.#tokenService = new TokenService(this.#keyStore, this.#jwtProvider!, this.#refreshTokenRepo, {
			accessTokenTtl: "15m",
			refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
			cookieDomain: this.#cookieDomain,
		});

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

		this.#oauthRegistry = new OAuthProviderRegistry();
		this.#oauthRegistry.register(
			new PlatformAuthProvider(async (username, password) => {
				return this.#validatePlatformCredentials(username, password);
			})
		);

		// Inicializar singletons de endpoints. ModerationService es opcional: se tipa
		// contra la interfaz de @common, nunca contra la clase concreta.
		if (!this.#moderation) {
			const mod = this.tryGetMyService<IModerationService>("ModerationService");
			this.#moderation = mod ? mod._internal(this.getCapability()) : null;
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
				// Aviso al usuario cuando se detecta reuso de un refresh token (posible robo) y se
				// revoca su familia de sesiones. Mismo canal seguro que las sesiones revocadas.
				onTokenReuse: (userId: string) =>
					void this.emitSecureNotification({
						userId,
						topic: "security.sessions_revoked",
						title: "Cerramos tus sesiones por seguridad",
						body: "Detectamos el reuso de un token de sesión (posible robo). Volvé a iniciar sesión.",
					}),
			},
			(username: string, password: string) => this.#validatePlatformCredentials(username, password)
		);

		SessionAdminEndpoints.init({
			refreshTokenRepo: this.#refreshTokenRepo,
			identityService: this.#identityService,
			logger: this.logger,
			// Aviso canónico al usuario expulsado (plantilla server-side security.sessions_revoked).
			// Vía segura (reenvía la capability): origin infalsificable desde `cap.owner`.
			notifyRevoked: (targetUserId) =>
				void this.emitSecureNotification({
					userId: targetUserId,
					topic: "security.sessions_revoked",
					title: "Tus sesiones fueron cerradas",
					body: "Un administrador cerró tus sesiones activas.",
				}),
			// Alerta al equipo de seguridad (via NotifyManager de Identity; requiere identity:internal).
			notifySecurityTeam: (event) => {
				try {
					void this.#identityService?.notifications(this.getCapability()).securityEvent(event);
				} catch (err: any) {
					this.logger.logDebug(`Alerta de seguridad no emitida: ${err?.message || err}`);
				}
			},
		});

		LegalEndpoints.init({
			internalIdentity: this.#internalIdentity,
			logger: this.logger,
		});

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

		const orgKey = orgId || "global";
		const cacheKey = `session:permfp:${userId}:${orgKey}`;
		if (this.#redis) {
			try {
				// Sobre sellado: un valor manipulado en Redis no abre y cuenta como miss. Este
				// set NO es informativo — `verifyToken` lo usa como permisos del request.
				const cached = openPermissions(await this.#redis.get(cacheKey), userId, orgKey, this.logger);
				if (cached) return cached;
			} catch {
				/* cache best-effort */
			}
		}

		try {
			const resolved = await this.#identityService.permissions.resolvePermissions(userId, orgId);
			const permissionStrings = resolved.map((permission) => `${permission.resource}.${permission.scope}.${permission.action}`);

			if (this.#redis) {
				try {
					await this.#redis.set(
						cacheKey,
						sealPermissions(userId, orgKey, permissionStrings, this.logger),
						PERMISSION_FINGERPRINT_TTL_SECONDS
					);
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
	 * Login programático (sin HTTP): autentica con credenciales y mintea un token.
	 * Gateado por capability con scope `session:programmatic`: un módulo debe declararlo
	 * en sus `privileges` para poder crear sesiones sin flujo interactivo.
	 *
	 * @returns Token de acceso válido o null si las credenciales son inválidas
	 */
	async loginProgrammatic(cap: CapabilityToken, username: string, password: string): Promise<string | null> {
		assertScope(cap, Scope.SessionProgrammatic);

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
	 * Revoca todos los refresh tokens del usuario. Lo llama IdentityManagerService al
	 * desactivar una cuenta (ban, baja, desactivación administrativa): sin esto, el
	 * refresh token del baneado sigue siendo canjeable por access tokens nuevos.
	 *
	 * No invalida el access token vigente —es un JWT sin estado—, pero ese vence en
	 * `accessTokenTtl` (15m) y el refresh ya no está para renovarlo. El corte inmediato
	 * del canje lo hace además `getUserById` en el handler de `/api/auth/refresh`, que
	 * rechaza a los usuarios con `isActive === false`.
	 */
	async revokeUserSessions(cap: CapabilityToken, userId: string): Promise<number> {
		assertScope(cap, Scope.SessionRevoke);

		if (!this.#tokenService) throw new Error("SessionManagerService no está inicializado");
		if (!userId) return 0;

		const revoked = await this.#tokenService.revokeAllUserTokens(userId);
		if (revoked > 0) this.logger.logInfo(`[SessionManager] ${revoked} sesión(es) revocadas para ${userId}`);
		return revoked;
	}

	/**
	 * Sesiones activas para el export de datos (derecho de acceso, art. 14 Ley 25.326 / art. 15
	 * RGPD). Espejo del contrato de purga: el caller prueba scope `identity:internal`. La IP va
	 * enmascarada como en la vista admin y los tokens nunca salen: son credenciales, no datos.
	 */
	async exportUserData(cap: CapabilityToken, userId: string): Promise<unknown> {
		assertScope(cap, Scope.IdentityInternal);
		const repo = this.#refreshTokenRepo;
		if (!userId || !repo) return { activeSessions: [] };
		const tokens = await repo.listForUser(userId);
		return {
			activeSessions: tokens.map((t) => ({
				deviceId: t.deviceId,
				createdAt: new Date(t.createdAt).toISOString(),
				expiresAt: new Date(t.expiresAt).toISOString(),
				country: t.country,
				userAgent: t.userAgent,
				ip: maskIp(t.ipAddress),
			})),
			note: {
				es: "IP parcialmente enmascarada (la misma vista que el panel de seguridad). Los tokens de sesión no se exportan: son credenciales, no datos personales.",
				en: "Partially masked IP (same view as the security panel). Session tokens are not exported: they are credentials, not personal data.",
			},
		};
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
			await this.emitSecureNotification({
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
		if (this.#legalCheckTimer) clearTimeout(this.#legalCheckTimer);
		this.#legalCheckTimer = null;

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
