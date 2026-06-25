import type { TokenService } from "../domain/tokens/TokenService.js";
import type { GeoIPValidator } from "../domain/security/GeoIPValidator.js";
import type { SessionManager } from "../domain/session/manager.js";
import type { OAuthProviderRegistry } from "../domain/oauth/index.js";
import type { DiscordOAuthProvider } from "../domain/oauth/discord.js";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";
import type { IdentityInternalWithDiscord } from "../../../core/IdentityManagerService/internal.js";
import type RedisProvider from "../../../../providers/queue/redis/index.js";
import {
	RegisterEndpoint,
	UncommonResponse,
	type EndpointCtx,
	type SetCookie,
	type ClearCookie,
} from "../../../core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import type { AuthenticatedUser, IOAuthProvider, ModerationLookupService, OAuthProviderConfig } from "../types.js";
import { buildErrorUrl } from "../utils/errorRedirect.js";
import { recordLoginAttemptIp, redirectIfRequestBanned } from "../utils/moderationGuards.js";
import { syncDiscordRolesForUser } from "../utils/discordRoleSync.js";
import {
	assertPendingLinkPassword,
	requirePendingLinkPassword,
	requirePendingLinkToken,
	requireValidPendingLinkEntry,
	type PendingLinkEntry,
} from "../utils/pendingLinks.js";
import * as OAS from "./schemas/oauth.js";

/** Nombre de las cookies */
const STATE_COOKIE_NAME = "oauth_state";
const RETURN_URL_COOKIE_NAME = "oauth_return_url";
const PENDING_LINK_COOKIE_NAME = "oauth_pending_link";

const isProd = process.env.NODE_ENV === "production";

/** Datos pendientes para vincular cuenta OAuth con usuario existente */
interface PendingLinkData {
	provider: string;
	providerId: string;
	providerUsername: string;
	providerAvatar?: string;
	email: string;
	accessToken: string;
}

/** Max intentos de contraseña por pending link antes de consumirlo */
const MAX_LINK_ATTEMPTS = 3;
/** TTL del pending link en segundos (5 minutos) */
const PENDING_LINK_TTL_SECONDS = 5 * 60;
/** Prefijo Redis para pending links */
const REDIS_PENDING_PREFIX = "oauth:pending:";

/** Dominios permitidos para returnUrl (anti open redirect) */
const ALLOWED_REDIRECT_DOMAINS = new Set(["adigitalcafe.com", "localhost"]);

/** Resultado de getOrCreateUser */
type GetOrCreateUserResult = { type: "authenticated"; user: AuthenticatedUser } | { type: "requires_link"; pendingData: PendingLinkData };

interface OAuthEndpointsDeps {
	tokenService: TokenService;
	geoValidator: GeoIPValidator;
	sessionManager: SessionManager;
	oauthRegistry: OAuthProviderRegistry;
	identityService: IIdentityManagerService | null;
	internalIdentity: IdentityInternalWithDiscord | null;
	redis: RedisProvider | null;
	cookieDomain: string;
	defaultRedirectUrl: string;
	getProviderConfig: (provider: string) => OAuthProviderConfig | null;
	logger: { logError: (msg: string) => void; logWarn: (msg: string) => void };
	moderation: ModerationLookupService | null;
}

interface ProviderParams {
	provider: string;
}

type InternalIdentity = NonNullable<OAuthEndpointsDeps["internalIdentity"]>;
type InternalUserManager = InternalIdentity["users"];
type InternalUser = NonNullable<Awaited<ReturnType<InternalUserManager["getUserByEmail"]>>>;

interface CallbackRequest {
	code: string;
	returnUrl: string;
	oauthProvider: IOAuthProvider;
	config: OAuthProviderConfig;
}

/**
 * Endpoints de autenticación OAuth (Discord, Google, etc.)
 * Singleton con métodos estáticos y @RegisterEndpoint
 */
export class OAuthEndpoints {
	private static deps: OAuthEndpointsDeps;

	/** Fallback en memoria si Redis no está disponible */
	private static readonly pendingLinks = new Map<string, PendingLinkEntry<PendingLinkData>>();

	/** Intervalo de limpieza (solo sin Redis — Redis usa TTL nativo) */
	private static cleanupInterval: ReturnType<typeof setInterval> | null = null;

	static init(deps: OAuthEndpointsDeps): void {
		OAuthEndpoints.deps ??= deps;

		// Limpieza periódica solo si no hay Redis
		if (!deps.redis && !OAuthEndpoints.cleanupInterval) {
			OAuthEndpoints.cleanupInterval = setInterval(() => {
				const now = Date.now();
				for (const [token, entry] of OAuthEndpoints.pendingLinks) {
					if (now > entry.expiresAt) OAuthEndpoints.pendingLinks.delete(token);
				}
			}, 60_000);
			OAuthEndpoints.cleanupInterval.unref();
		}
	}

	/**
	 * GET /api/auth/login/:provider - Iniciar flujo OAuth
	 */
	@RegisterEndpoint({
		method: "GET",
		url: "/api/auth/login/:provider",
		permissions: [],
		options: {
			tag: "SessionManagerService/OAuth",
			summary: "Inicia el flujo OAuth de un proveedor",
			description: "Genera el `state` (CSRF) y redirige (302) a la URL de autorización del proveedor. Acepta `returnUrl` para el redirect post-auth.",
			rateLimit: { max: 10, timeWindow: 60_000 },
			schema: { params: OAS.ProviderParams, querystring: OAS.OAuthLoginQuery },
		},
	})
	static async handleLogin(ctx: EndpointCtx<ProviderParams>): Promise<never> {
		const provider = ctx.params.provider || "platform";

		if (!OAuthEndpoints.deps.oauthRegistry.has(provider)) {
			throw new AuthError(400, "PROVIDER_NOT_SUPPORTED", `Proveedor '${provider}' no soportado`);
		}

		const oauthProvider = OAuthEndpoints.deps.oauthRegistry.get(provider)!;
		const config = OAuthEndpoints.deps.getProviderConfig(provider);

		if (!config) {
			throw new AuthError(500, "PROVIDER_CONFIG_NOT_FOUND", `Configuración del proveedor '${provider}' no encontrada`);
		}

		// Capturar returnUrl de query params para redirect post-auth
		const returnUrl = ctx.query?.returnUrl || "";

		// Generar state para CSRF protection
		const state = OAuthEndpoints.deps.sessionManager.generateState();

		// Preparar cookies
		const cookies: SetCookie[] = [
			{
				name: STATE_COOKIE_NAME,
				value: state,
				options: {
					httpOnly: true,
					secure: isProd,
					sameSite: "lax",
					path: "/",
					maxAge: 10 * 60, // 10 minutos
				},
			},
		];

		// Guardar returnUrl en cookie separada si está presente
		if (returnUrl) {
			cookies.push({
				name: RETURN_URL_COOKIE_NAME,
				value: returnUrl,
				options: {
					httpOnly: true,
					secure: isProd,
					sameSite: "lax",
					path: "/",
					maxAge: 10 * 60,
				},
			});
		}

		const authUrl = oauthProvider.getAuthorizationUrl(state, config);
		throw UncommonResponse.redirect(authUrl, { status: 302, cookies });
	}

	/**
	 * GET /api/auth/callback/:provider - Callback OAuth
	 */
	@RegisterEndpoint({
		method: "GET",
		url: "/api/auth/callback/:provider",
		permissions: [],
		options: {
			tag: "SessionManagerService/OAuth",
			summary: "Callback OAuth del proveedor",
			description: "Intercambia el `code`, crea/recupera el usuario y redirige (302). Si el email coincide con una cuenta existente, redirige a vinculación.",
			rateLimit: { max: 10, timeWindow: 60_000 },
			schema: { params: OAS.ProviderParams },
		},
	})
	static async handleCallback(ctx: EndpointCtx<ProviderParams>): Promise<never> {
		const provider = ctx.params.provider || "platform";
		const clearCookies = OAuthEndpoints.getOAuthClearCookies();
		const { code, returnUrl, oauthProvider, config } = OAuthEndpoints.resolveCallbackRequest(ctx, provider, clearCookies);

		try {
			const tokens = await oauthProvider.exchangeCode(code, config);
			const profile = await oauthProvider.getUserProfile(tokens.accessToken);

			// Anti-evasión: bloquear si el email OAuth está en la ban-list
			await redirectIfRequestBanned({ moderation: OAuthEndpoints.deps.moderation, email: profile.email, ip: ctx.ip, clearCookies });

			const result = await OAuthEndpoints.getOrCreateUser(provider, profile, tokens.accessToken);

			// Email coincide con usuario existente → redirigir a vinculación con autenticación
			if (result.type === "requires_link") {
				return await OAuthEndpoints.redirectToLinkAccount(provider, result.pendingData, returnUrl, clearCookies);
			}

			const user = result.user;

			// Bloquear cuentas baneadas/deshabilitadas (evita evasión por OAuth tras ban administrativo)
			OAuthEndpoints.redirectIfInactiveUser(user, clearCookies);

			// Registrar IP del login OAuth (3h) para alimentar ban-list anti-evasión
			await recordLoginAttemptIp(OAuthEndpoints.deps.moderation, user.id, ctx.ip, OAuthEndpoints.deps.logger);

			await OAuthEndpoints.syncDiscordLogin(provider, tokens.accessToken, user, oauthProvider);

			const tokenCookies = await OAuthEndpoints.getTokenCookies(ctx, user);

			// Redirigir al returnUrl o al default
			const redirectUrl = OAuthEndpoints.getRedirectUrl(user, returnUrl);
			throw UncommonResponse.redirect(redirectUrl, {
				status: 302,
				cookies: tokenCookies,
				clearCookies,
			});
		} catch (err: any) {
			// Si ya es un UncommonResponse o AuthError, re-lanzar
			if (err instanceof UncommonResponse || err instanceof AuthError) throw err;

			OAuthEndpoints.deps.logger.logError(`Error en callback de ${provider}: ${err.message}`);
			throw UncommonResponse.redirect(buildErrorUrl("/oauth", { provider, message: "Error durante la autenticación" }), {
				status: 302,
				clearCookies,
			});
		}
	}

	/**
	 * POST /api/auth/link-account - Vincular cuenta OAuth con usuario existente (requiere contraseña)
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/link-account",
		permissions: [],
		options: {
			tag: "SessionManagerService/OAuth",
			summary: "Vincula una cuenta OAuth con un usuario existente",
			description: "Requiere el token de vinculación pendiente (cookie) y la contraseña del usuario existente.",
			skipIdempotency: true,
			rateLimit: { max: 3, timeWindow: 300_000 },
			schema: { body: OAS.LinkAccountBody },
		},
	})
	static async handleLinkAccount(ctx: EndpointCtx<Record<string, string>>): Promise<never> {
		const pendingToken = requirePendingLinkToken(ctx.cookies?.[PENDING_LINK_COOKIE_NAME]);
		const entry = await OAuthEndpoints.getValidPendingLink(pendingToken);
		const pendingData = entry.data;
		const password = requirePendingLinkPassword(ctx.data as { password?: string } | undefined);
		const users = OAuthEndpoints.requireInternalIdentity().users;
		const existingUser = await OAuthEndpoints.getPendingLinkUser(users, pendingData.email, pendingToken);

		await assertPendingLinkPassword({
			pendingToken,
			entry,
			username: existingUser.username,
			password,
			maxAttempts: MAX_LINK_ATTEMPTS,
			authenticate: (username, candidatePassword) => users.authenticate(username, candidatePassword),
			storePendingLink: OAuthEndpoints.storePendingLink,
			deletePendingLink: OAuthEndpoints.deletePendingLink,
		});

		// Éxito → consumir token (one-time use)
		await OAuthEndpoints.deletePendingLink(pendingToken);

		// Vincular external account
		await users.linkExternalAccount(existingUser.id, {
			provider: pendingData.provider,
			providerId: pendingData.providerId,
			providerUsername: pendingData.providerUsername,
			providerAvatar: pendingData.providerAvatar,
			status: "linked",
			linkedAt: new Date(),
		});

		await OAuthEndpoints.syncPendingLinkProvider(pendingData, existingUser.id);

		const user = await OAuthEndpoints.buildLinkedAccountUser(existingUser, pendingData);

		const tokenCookies = await OAuthEndpoints.getTokenCookies(ctx as unknown as EndpointCtx<ProviderParams>, user);
		const clearLinkCookies: ClearCookie[] = [
			{ name: PENDING_LINK_COOKIE_NAME, options: { path: "/" } },
			{ name: RETURN_URL_COOKIE_NAME, options: { path: "/" } },
		];

		throw UncommonResponse.json(
			{
				success: true,
				user: {
					id: user.id,
					username: user.username,
					email: user.email,
					avatar: user.avatar,
				},
			},
			{ cookies: tokenCookies, clearCookies: clearLinkCookies }
		);
	}

	// ============ Métodos auxiliares (privados estáticos) ============

	private static getOAuthClearCookies(): ClearCookie[] {
		return [
			{ name: STATE_COOKIE_NAME, options: { path: "/" } },
			{ name: RETURN_URL_COOKIE_NAME, options: { path: "/" } },
		];
	}

	private static resolveCallbackRequest(ctx: EndpointCtx<ProviderParams>, provider: string, clearCookies: ClearCookie[]): CallbackRequest {
		const { code, state, error } = ctx.query || {};

		if (error) {
			throw UncommonResponse.redirect(buildErrorUrl("/oauth", { provider, message: error }), { status: 302, clearCookies });
		}

		if (!code || !state) {
			throw UncommonResponse.redirect(buildErrorUrl("/oauth", { provider, message: "Código o estado faltante" }), {
				status: 302,
				clearCookies,
			});
		}

		const stateCookie = ctx.cookies?.[STATE_COOKIE_NAME];
		if (!stateCookie || !OAuthEndpoints.deps.sessionManager.validateState(state, stateCookie)) {
			throw UncommonResponse.redirect(buildErrorUrl("/csrf"), { status: 302, clearCookies });
		}

		const oauthProvider = OAuthEndpoints.deps.oauthRegistry.get(provider);
		if (!oauthProvider) {
			throw UncommonResponse.redirect(buildErrorUrl("/oauth", { provider, message: "Proveedor no encontrado" }), {
				status: 302,
				clearCookies,
			});
		}

		const config = OAuthEndpoints.deps.getProviderConfig(provider);
		if (!config) {
			throw new AuthError(500, "PROVIDER_CONFIG_NOT_FOUND", "Configuración del proveedor no encontrada");
		}

		return { code, returnUrl: ctx.cookies?.[RETURN_URL_COOKIE_NAME] || "", oauthProvider, config };
	}

	private static async redirectToLinkAccount(
		provider: string,
		pendingData: PendingLinkData,
		returnUrl: string,
		clearCookies: ClearCookie[]
	): Promise<never> {
		const { randomBytes } = await import("node:crypto");
		const pendingToken = randomBytes(32).toString("hex");
		const now = Date.now();

		await OAuthEndpoints.storePendingLink(pendingToken, {
			data: pendingData,
			createdAt: now,
			expiresAt: now + PENDING_LINK_TTL_SECONDS * 1000,
			attempts: 0,
		});

		const linkRedirect = `/auth/link-account?provider=${provider}&email=${encodeURIComponent(pendingData.email)}`;
		throw UncommonResponse.redirect(linkRedirect, {
			status: 302,
			cookies: OAuthEndpoints.buildPendingLinkCookies(pendingToken, returnUrl),
			clearCookies,
		});
	}

	private static buildPendingLinkCookies(pendingToken: string, returnUrl: string): SetCookie[] {
		const pendingCookies: SetCookie[] = [
			{
				name: PENDING_LINK_COOKIE_NAME,
				value: pendingToken,
				options: {
					httpOnly: true,
					secure: isProd,
					sameSite: "lax",
					path: "/",
					maxAge: PENDING_LINK_TTL_SECONDS,
				},
			},
		];

		if (returnUrl) {
			pendingCookies.push({
				name: RETURN_URL_COOKIE_NAME,
				value: returnUrl,
				options: {
					httpOnly: true,
					secure: isProd,
					sameSite: "lax",
					path: "/",
					maxAge: PENDING_LINK_TTL_SECONDS,
				},
			});
		}

		return pendingCookies;
	}

	private static redirectIfInactiveUser(user: AuthenticatedUser, clearCookies: ClearCookie[]): void {
		if (user.isActive === false) {
			const banReason = (user.metadata as any)?.banReason || "Cuenta deshabilitada";
			throw UncommonResponse.redirect(buildErrorUrl("/banned", { reason: banReason }), { status: 302, clearCookies });
		}
	}

	private static async syncDiscordLogin(
		provider: string,
		accessToken: string,
		user: AuthenticatedUser,
		oauthProvider: IOAuthProvider
	): Promise<void> {
		if (provider !== "discord") return;

		await OAuthEndpoints.syncDiscordRoles(accessToken, user.id, oauthProvider as DiscordOAuthProvider);
		if (OAuthEndpoints.deps.identityService) {
			user.permissions = await OAuthEndpoints.getUserPermissions(user.id);
		}
	}

	private static async getValidPendingLink(pendingToken: string): Promise<PendingLinkEntry<PendingLinkData>> {
		const entry = await OAuthEndpoints.getPendingLink(pendingToken);
		return requireValidPendingLinkEntry(pendingToken, entry, OAuthEndpoints.deletePendingLink);
	}

	private static requireInternalIdentity(): InternalIdentity {
		if (!OAuthEndpoints.deps.internalIdentity) {
			throw new AuthError(500, "IDENTITY_NOT_AVAILABLE", "Servicio de identidad no disponible");
		}
		return OAuthEndpoints.deps.internalIdentity;
	}

	private static async getPendingLinkUser(users: InternalUserManager, email: string, pendingToken: string): Promise<InternalUser> {
		const existingUser = await users.getUserByEmail(email);
		if (!existingUser) {
			await OAuthEndpoints.deletePendingLink(pendingToken);
			throw new AuthError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		}
		return existingUser;
	}

	private static async syncPendingLinkProvider(pendingData: PendingLinkData, userId: string): Promise<void> {
		if (pendingData.provider !== "discord") return;

		const discordProvider = OAuthEndpoints.deps.oauthRegistry.get("discord") as DiscordOAuthProvider | undefined;
		if (discordProvider) {
			await OAuthEndpoints.syncDiscordRoles(pendingData.accessToken, userId, discordProvider);
		}
	}

	private static async buildLinkedAccountUser(existingUser: InternalUser, pendingData: PendingLinkData): Promise<AuthenticatedUser> {
		const permissions = await OAuthEndpoints.getUserPermissions(existingUser.id);
		return {
			id: existingUser.id,
			providerId: pendingData.providerId,
			provider: pendingData.provider,
			username: existingUser.username,
			email: existingUser.email,
			avatar: pendingData.providerAvatar,
			permissions,
			metadata: existingUser.metadata,
		};
	}

	private static async getTokenCookies(ctx: EndpointCtx<ProviderParams>, user: AuthenticatedUser): Promise<SetCookie[]> {
		const ipAddress = OAuthEndpoints.deps.geoValidator.extractRealIP(ctx.headers, ctx.ip);
		const country = OAuthEndpoints.deps.geoValidator.getCountryFromHeaders(ctx.headers);
		const deviceId = OAuthEndpoints.generateDeviceId(ctx.headers);
		const userAgent = ctx.headers["user-agent"]?.toString() || "unknown";

		const tokens = await OAuthEndpoints.deps.tokenService.createTokenPair(user, deviceId, ipAddress, country, userAgent);

		const accessConfig = OAuthEndpoints.deps.tokenService.getAccessCookieConfig();
		const refreshConfig = OAuthEndpoints.deps.tokenService.getRefreshCookieConfig();

		return [
			{
				name: accessConfig.name,
				value: tokens.accessToken,
				options: {
					httpOnly: accessConfig.httpOnly,
					secure: accessConfig.secure,
					sameSite: accessConfig.sameSite,
					path: accessConfig.path,
					maxAge: accessConfig.maxAge,
					domain: accessConfig.domain,
				},
			},
			{
				name: refreshConfig.name,
				value: tokens.refreshToken.token,
				options: {
					httpOnly: refreshConfig.httpOnly,
					secure: refreshConfig.secure,
					sameSite: refreshConfig.sameSite,
					path: refreshConfig.path,
					maxAge: refreshConfig.maxAge,
					domain: refreshConfig.domain,
				},
			},
		];
	}

	/**
	 * Identificador best-effort del dispositivo SOLO para telemetría/UX (listado de sesiones).
	 * No es criptográficamente fuerte ni resistente a suplantación: NUNCA usarlo para
	 * decisiones de seguridad (authz, rate limiting, detección de fraude).
	 */
	private static generateDeviceId(headers: Record<string, string | undefined>): string {
		const ua = headers["user-agent"]?.toString() || "";
		const accept = headers["accept"]?.toString() || "";
		const lang = headers["accept-language"]?.toString() || "";

		const fingerprint = `${ua}|${accept}|${lang}`;
		let hash = 0;
		for (let i = 0; i < fingerprint.length; i++) {
			const char = fingerprint.codePointAt(i) ?? -1;
			hash = (hash << 5) - hash + char;
			hash = hash & hash;
		}

		return `device_${Math.abs(hash).toString(36)}`;
	}

	private static getRedirectUrl(user: AuthenticatedUser, returnUrl?: string): string {
		if (returnUrl && OAuthEndpoints.isAllowedRedirectUrl(returnUrl)) return returnUrl;

		const baseUrl = user.orgId ? `https://${user.orgId}.adigitalcafe.com` : OAuthEndpoints.deps.defaultRedirectUrl;
		return baseUrl;
	}

	/**
	 * Valida que la URL de redirect pertenece a un dominio permitido (anti open redirect).
	 */
	private static isAllowedRedirectUrl(url: string): boolean {
		// Límite defensivo de longitud
		if (url.length > 2048) return false;

		// Solo paths relativos. Rechazar protocol-relative ("//evil.com") y "/\" (backslash trick)
		if (url.startsWith("/")) {
			return !url.startsWith("//") && !url.startsWith("/\\");
		}

		try {
			const parsed = new URL(url);
			const hostname = parsed.hostname;

			// Match exacto o subdominio de dominios permitidos
			for (const allowed of ALLOWED_REDIRECT_DOMAINS) {
				if (hostname === allowed || hostname.endsWith(`.${allowed}`)) return true;
			}
		} catch {
			// URL mal formada → rechazar
		}

		return false;
	}

	// ============ Pending Link Store (Redis con fallback a Map) ============

	/**
	 * Almacena un pending link en Redis (con TTL nativo) o en memoria.
	 */
	private static async storePendingLink(token: string, entry: PendingLinkEntry<PendingLinkData>): Promise<void> {
		if (OAuthEndpoints.deps.redis) {
			await OAuthEndpoints.deps.redis.setex(`${REDIS_PENDING_PREFIX}${token}`, PENDING_LINK_TTL_SECONDS, JSON.stringify(entry));
			return;
		}
		OAuthEndpoints.pendingLinks.set(token, entry);
	}

	/**
	 * Recupera un pending link de Redis o de memoria.
	 */
	private static async getPendingLink(token: string): Promise<PendingLinkEntry<PendingLinkData> | null> {
		if (OAuthEndpoints.deps.redis) {
			const data = await OAuthEndpoints.deps.redis.get(`${REDIS_PENDING_PREFIX}${token}`);
			if (!data) return null;
			return JSON.parse(data) as PendingLinkEntry<PendingLinkData>;
		}

		return OAuthEndpoints.pendingLinks.get(token) || null;
	}

	/**
	 * Elimina un pending link de Redis o de memoria.
	 */
	private static async deletePendingLink(token: string): Promise<void> {
		if (OAuthEndpoints.deps.redis) {
			await OAuthEndpoints.deps.redis.del(`${REDIS_PENDING_PREFIX}${token}`);
			return;
		}
		OAuthEndpoints.pendingLinks.delete(token);
	}

	private static async getOrCreateUser(
		provider: string,
		profile: { id: string; username: string; email?: string; avatar?: string },
		accessToken: string
	): Promise<GetOrCreateUserResult> {
		if (!OAuthEndpoints.deps.internalIdentity) {
			return {
				type: "authenticated",
				user: {
					id: `temp_${profile.id}`,
					providerId: profile.id,
					provider,
					username: profile.username,
					email: profile.email,
					avatar: profile.avatar,
					permissions: ["public.read"],
				},
			};
		}

		const users = OAuthEndpoints.deps.internalIdentity.users;

		// 1. Buscar por linked account activo (provider + providerId)
		const linkedUser = await users.findByLinkedExternalAccount(provider, profile.id);

		if (linkedUser) {
			// Ya vinculado → login directo
			const permissions = await OAuthEndpoints.getUserPermissions(linkedUser.id);
			return {
				type: "authenticated",
				user: {
					id: linkedUser.id,
					providerId: profile.id,
					provider,
					username: linkedUser.username,
					email: linkedUser.email,
					avatar: profile.avatar || linkedUser.linkedAccounts?.find((la) => la.provider === provider)?.providerAvatar,
					permissions,
					metadata: linkedUser.metadata,
					isActive: linkedUser.isActive,
				},
			};
		}

		// 2. Si email coincide con usuario existente → requiere autenticación para vincular
		if (profile.email) {
			const emailUser = await users.getUserByEmail(profile.email);
			if (emailUser) {
				return {
					type: "requires_link",
					pendingData: {
						provider,
						providerId: profile.id,
						providerUsername: profile.username,
						providerAvatar: profile.avatar,
						email: profile.email,
						accessToken,
					},
				};
			}
		}

		// 3. No match → crear usuario nuevo con username único
		const { randomBytes } = await import("node:crypto");
		const randomPassword = randomBytes(16).toString("base64");
		const uniqueUsername = await OAuthEndpoints.generateUniqueUsername(profile.username, users);
		const newUser = await users.createUser(uniqueUsername, randomPassword, []);

		await users.updateUser(newUser.id, {
			email: profile.email,
			linkedAccounts: [
				{
					provider,
					providerId: profile.id,
					providerUsername: profile.username,
					providerAvatar: profile.avatar,
					status: "linked",
					linkedAt: new Date(),
				},
			],
			metadata: {
				avatar: profile.avatar,
				createdVia: provider,
			},
		});

		const defaultPermissions = await OAuthEndpoints.getDefaultPermissions();
		return {
			type: "authenticated",
			user: {
				id: newUser.id,
				providerId: profile.id,
				provider,
				username: newUser.username,
				email: profile.email,
				avatar: profile.avatar,
				permissions: defaultPermissions,
			},
		};
	}

	/**
	 * Genera un username único añadiendo sufijo aleatorio si hay colisión.
	 */
	private static async generateUniqueUsername(
		baseUsername: string,
		users: { getUserByUsername: (username: string) => Promise<unknown> }
	): Promise<string> {
		const existing = await users.getUserByUsername(baseUsername);
		if (!existing) return baseUsername;

		const { randomBytes } = await import("node:crypto");
		for (let i = 0; i < 5; i++) {
			const suffix = randomBytes(3).toString("hex");
			const candidate = `${baseUsername}_d${suffix}`;
			const exists = await users.getUserByUsername(candidate);
			if (!exists) return candidate;
		}

		// Fallback extremo
		return `${baseUsername}_d${Date.now().toString(36)}`;
	}

	/**
	 * Sincroniza roles de Discord guild → roles de plataforma.
	 * - Obtiene roles del usuario en el guild via API de Discord
	 * - Traduce Discord Role IDs → nombres de roles de plataforma via discordRoleMap
	 * - Agrega roles mapeados que tiene en Discord, remueve los que ya no tiene
	 * - Solo toca roles que están en el mapa, no roles asignados manualmente
	 */
	private static async syncDiscordRoles(accessToken: string, userId: string, discordProvider: DiscordOAuthProvider): Promise<void> {
		await syncDiscordRolesForUser({ accessToken, userId, discordProvider, internalIdentity: OAuthEndpoints.deps.internalIdentity });
	}

	private static async getUserPermissions(userId: string): Promise<string[]> {
		if (!OAuthEndpoints.deps.identityService) return ["public.read"];

		try {
			const permissions = OAuthEndpoints.deps.identityService.permissions;
			const resolved = await permissions.resolvePermissions(userId);
			return resolved.map((p: { resource: string; scope: number; action: number }) => `${p.resource}.${p.scope}.${p.action}`);
		} catch {
			return ["public.read"];
		}
	}

	private static async getDefaultPermissions(): Promise<string[]> {
		return ["public.read", "profile.self.read", "profile.self.write"];
	}
}
