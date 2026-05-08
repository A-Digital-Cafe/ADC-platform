import type { TokenService } from "../domain/tokens/TokenService.js";
import type { GeoIPValidator } from "../domain/security/GeoIPValidator.js";
import type { SessionManager } from "../domain/session/manager.js";
import type { OAuthProviderRegistry } from "../domain/oauth/index.js";
import type { DiscordOAuthProvider } from "../domain/oauth/discord.js";
import type IdentityManagerService from "../../../core/IdentityManagerService/index.js";
import type RedisProvider from "../../../../providers/queue/redis/index.js";
import {
	RegisterEndpoint,
	UncommonResponse,
	type EndpointCtx,
	type SetCookie,
	type ClearCookie,
} from "../../../core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import type { AuthenticatedUser, OAuthProviderConfig } from "../types.js";

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

/** Entrada en el store server-side de pending links */
interface PendingLinkEntry {
	data: PendingLinkData;
	createdAt: number;
	expiresAt: number;
	attempts: number;
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
	identityService: IdentityManagerService | null;
	internalIdentity: ReturnType<IdentityManagerService["_internal"]> | null;
	redis: RedisProvider | null;
	cookieDomain: string;
	defaultRedirectUrl: string;
	getProviderConfig: (provider: string) => OAuthProviderConfig | null;
	logger: { logError: (msg: string) => void; logWarn: (msg: string) => void };
}

interface ProviderParams {
	provider: string;
}

/**
 * Endpoints de autenticación OAuth (Discord, Google, etc.)
 * Singleton con métodos estáticos y @RegisterEndpoint
 */
export class OAuthEndpoints {
	private static deps: OAuthEndpointsDeps;

	/** Fallback en memoria si Redis no está disponible */
	private static readonly pendingLinks = new Map<string, PendingLinkEntry>();

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
	})
	static async handleCallback(ctx: EndpointCtx<ProviderParams>): Promise<never> {
		const provider = ctx.params.provider || "platform";
		const { code, state, error } = ctx.query || {};

		// Cookies a limpiar (siempre limpiar state cookies)
		const clearCookies: ClearCookie[] = [
			{ name: STATE_COOKIE_NAME, options: { path: "/" } },
			{ name: RETURN_URL_COOKIE_NAME, options: { path: "/" } },
		];

		if (error) {
			throw UncommonResponse.redirect(`/auth/error?error=${encodeURIComponent(error)}`, {
				status: 302,
				clearCookies,
			});
		}

		if (!code || !state) {
			throw UncommonResponse.redirect("/auth/error?error=Código o estado faltante", {
				status: 302,
				clearCookies,
			});
		}

		// Validar state contra la cookie
		const stateCookie = ctx.cookies?.[STATE_COOKIE_NAME];
		if (!stateCookie) {
			throw UncommonResponse.redirect("/auth/error?error=Estado faltante en cookies", {
				status: 302,
				clearCookies,
			});
		}

		// Usar el método validateState con ambos argumentos
		const stateValid = OAuthEndpoints.deps.sessionManager.validateState(state, stateCookie);
		if (!stateValid) {
			throw UncommonResponse.redirect("/auth/error?error=Estado inválido (posible ataque CSRF)", {
				status: 302,
				clearCookies,
			});
		}

		// Obtener returnUrl de la cookie
		const returnUrl = ctx.cookies?.[RETURN_URL_COOKIE_NAME] || "";

		const oauthProvider = OAuthEndpoints.deps.oauthRegistry.get(provider);
		if (!oauthProvider) {
			throw UncommonResponse.redirect("/auth/error?error=Proveedor no encontrado", {
				status: 302,
				clearCookies,
			});
		}

		const config = OAuthEndpoints.deps.getProviderConfig(provider);
		if (!config) {
			throw new AuthError(500, "PROVIDER_CONFIG_NOT_FOUND", "Configuración del proveedor no encontrada");
		}

		try {
			const tokens = await oauthProvider.exchangeCode(code, config);
			const profile = await oauthProvider.getUserProfile(tokens.accessToken);
			const result = await OAuthEndpoints.getOrCreateUser(provider, profile, tokens.accessToken);

			// Email coincide con usuario existente → redirigir a vinculación con autenticación
			if (result.type === "requires_link") {
				// Generar token opaco y almacenar datos server-side (Redis o fallback Map)
				const { randomBytes } = await import("node:crypto");
				const pendingToken = randomBytes(32).toString("hex");

				await OAuthEndpoints.storePendingLink(pendingToken, {
					data: result.pendingData,
					createdAt: Date.now(),
					expiresAt: Date.now() + PENDING_LINK_TTL_SECONDS * 1000,
					attempts: 0,
				});

				const pendingCookies: SetCookie[] = [
					{
						name: PENDING_LINK_COOKIE_NAME,
						value: pendingToken, // Solo token opaco, no datos
						options: {
							httpOnly: true,
							secure: isProd,
							sameSite: "lax",
							path: "/",
							maxAge: 5 * 60, // 5 minutos
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
							maxAge: 5 * 60,
						},
					});
				}

				const linkRedirect = `/auth/link-account?provider=${provider}&email=${encodeURIComponent(result.pendingData.email)}`;
				throw UncommonResponse.redirect(linkRedirect, {
					status: 302,
					cookies: pendingCookies,
					clearCookies,
				});
			}

			const user = result.user;

			// Discord autoroles: sincronizar roles de guild si es provider Discord
			if (provider === "discord" && OAuthEndpoints.deps.internalIdentity) {
				await OAuthEndpoints.syncDiscordRoles(tokens.accessToken, user.id, oauthProvider as DiscordOAuthProvider);
			}

			// Re-obtener permisos después de sync de roles (podrían haber cambiado)
			if (provider === "discord" && OAuthEndpoints.deps.identityService) {
				user.permissions = await OAuthEndpoints.getUserPermissions(user.id);
			}

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
			throw UncommonResponse.redirect(`/auth/error?error=${encodeURIComponent("Error durante la autenticación")}`, {
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
		options: { skipIdempotency: true, rateLimit: { max: 3, timeWindow: 300_000 } },
	})
	static async handleLinkAccount(ctx: EndpointCtx<Record<string, string>>): Promise<never> {
		const pendingToken = ctx.cookies?.[PENDING_LINK_COOKIE_NAME];
		if (!pendingToken) {
			throw new AuthError(400, "NO_PENDING_LINK", "No hay vinculación pendiente");
		}

		// Buscar datos en store server-side (Redis o fallback Map)
		const entry = await OAuthEndpoints.getPendingLink(pendingToken);
		if (!entry) {
			throw new AuthError(400, "INVALID_PENDING_LINK", "Vinculación expirada o inválida");
		}

		// Verificar expiración (en caso de fallback sin TTL nativo)
		if (Date.now() > entry.expiresAt) {
			await OAuthEndpoints.deletePendingLink(pendingToken);
			throw new AuthError(400, "INVALID_PENDING_LINK", "Vinculación expirada");
		}

		const pendingData = entry.data;

		const { password } = (ctx.data as { password?: string }) || {};
		if (!password) {
			throw new AuthError(400, "PASSWORD_REQUIRED", "Se requiere contraseña para vincular la cuenta");
		}

		if (!OAuthEndpoints.deps.internalIdentity) {
			throw new AuthError(500, "IDENTITY_NOT_AVAILABLE", "Servicio de identidad no disponible");
		}

		const users = OAuthEndpoints.deps.internalIdentity.users;
		const existingUser = await users.getUserByEmail(pendingData.email);
		if (!existingUser) {
			await OAuthEndpoints.deletePendingLink(pendingToken);
			throw new AuthError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		}

		// Verificar contraseña de la plataforma
		const authResult = await users.authenticate(existingUser.username, password);
		if (!authResult || ("wrongPassword" in authResult && authResult.wrongPassword)) {
			// Incrementar intentos — consumir token si se excede el máximo
			entry.attempts++;
			if (entry.attempts >= MAX_LINK_ATTEMPTS) {
				await OAuthEndpoints.deletePendingLink(pendingToken);
				throw new AuthError(401, "WRONG_PASSWORD", "Demasiados intentos fallidos, inicie el proceso nuevamente");
			}
			// Guardar intentos actualizados
			await OAuthEndpoints.storePendingLink(pendingToken, entry);
			throw new AuthError(401, "WRONG_PASSWORD", `Contraseña incorrecta (${MAX_LINK_ATTEMPTS - entry.attempts} intentos restantes)`);
		}
		if ("isActive" in authResult && !authResult.isActive) {
			await OAuthEndpoints.deletePendingLink(pendingToken);
			throw new AuthError(403, "ACCOUNT_DISABLED", "Cuenta deshabilitada");
		}

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

		// Sync Discord roles si aplica
		if (pendingData.provider === "discord" && pendingData.accessToken) {
			const discordProvider = OAuthEndpoints.deps.oauthRegistry.get("discord") as DiscordOAuthProvider | undefined;
			if (discordProvider) {
				await OAuthEndpoints.syncDiscordRoles(pendingData.accessToken, existingUser.id, discordProvider);
			}
		}

		const permissions = await OAuthEndpoints.getUserPermissions(existingUser.id);
		const user: AuthenticatedUser = {
			id: existingUser.id,
			providerId: pendingData.providerId,
			provider: pendingData.provider,
			username: existingUser.username,
			email: existingUser.email,
			avatar: pendingData.providerAvatar,
			permissions,
			metadata: existingUser.metadata,
		};

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
		// Solo paths relativos o URLs a dominios permitidos
		if (url.startsWith("/")) return true;

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
	private static async storePendingLink(token: string, entry: PendingLinkEntry): Promise<void> {
		if (OAuthEndpoints.deps.redis) {
			await OAuthEndpoints.deps.redis.setex(`${REDIS_PENDING_PREFIX}${token}`, PENDING_LINK_TTL_SECONDS, JSON.stringify(entry));
			return;
		}
		OAuthEndpoints.pendingLinks.set(token, entry);
	}

	/**
	 * Recupera un pending link de Redis o de memoria.
	 */
	private static async getPendingLink(token: string): Promise<PendingLinkEntry | null> {
		if (OAuthEndpoints.deps.redis) {
			const data = await OAuthEndpoints.deps.redis.get(`${REDIS_PENDING_PREFIX}${token}`);
			if (!data) return null;
			return JSON.parse(data) as PendingLinkEntry;
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
		if (!OAuthEndpoints.deps.internalIdentity) return;

		const { roles: roleManager, users, discordGuildId, getDiscordRoleMap } = OAuthEndpoints.deps.internalIdentity;
		if (!discordGuildId) return;

		// Fetch guild member roles desde Discord API
		const discordRoleIds = await discordProvider.fetchGuildMemberRoles(accessToken, discordGuildId);
		if (!discordRoleIds) return; // Failed or rate-limited

		// Obtener mapeo Discord Role ID → nombre de rol de plataforma
		const roleMap = await getDiscordRoleMap(discordGuildId);
		if (!roleMap || Object.keys(roleMap).length === 0) return;

		// Traducir Discord role IDs → nombres de roles de plataforma
		const mappedRoleNames = new Set<string>();
		for (const discordRoleId of discordRoleIds) {
			const platformRoleName = roleMap[discordRoleId];
			if (platformRoleName) mappedRoleNames.add(platformRoleName);
		}

		// Obtener todos los nombres de roles que están en el mapa (para saber cuáles remover)
		const allMappedRoleNames = new Set(Object.values(roleMap));

		// Resolver IDs de roles de plataforma por nombre
		const roleNameToId = new Map<string, string>();
		for (const roleName of allMappedRoleNames) {
			const role = await roleManager.getRoleByName(roleName);
			if (role) roleNameToId.set(roleName, role.id);
		}

		// Obtener usuario actual para sus roleIds
		const currentUser = await users.getUser(userId);
		if (!currentUser) return;

		const currentRoleIds = new Set(currentUser.roleIds || []);
		const allMappedRoleIds = new Set([...roleNameToId.values()]);

		// Calcular nuevos roleIds:
		// - Mantener todos los roles que NO están en el mapa (asignados manualmente)
		// - Agregar los roles mapeados que el usuario tiene en Discord
		// - Remover los roles mapeados que el usuario ya no tiene en Discord
		const newRoleIds = new Set<string>();

		// Mantener roles no-mapeados
		for (const roleId of currentRoleIds) {
			if (!allMappedRoleIds.has(roleId)) {
				newRoleIds.add(roleId);
			}
		}

		// Agregar roles mapeados que tiene en Discord
		for (const roleName of mappedRoleNames) {
			const roleId = roleNameToId.get(roleName);
			if (roleId) newRoleIds.add(roleId);
		}

		// Solo actualizar si cambió
		const sortedCurrent = [...currentRoleIds].sort((a, b) => a.localeCompare(b));
		const sortedNew = [...newRoleIds].sort((a, b) => a.localeCompare(b));
		if (sortedCurrent.join(",") !== sortedNew.join(",")) {
			await users.updateUser(userId, { roleIds: [...newRoleIds] });
		}
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
