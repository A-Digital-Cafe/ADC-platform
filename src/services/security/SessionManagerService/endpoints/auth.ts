import type { KeyStore } from "../domain/keys/KeyStore.js";
import type { TokenService } from "../domain/tokens/TokenService.js";
import type { RefreshTokenRepository } from "../domain/tokens/RefreshTokenRepository.js";
import type { LoginAttemptTracker } from "../domain/security/LoginAttemptTracker.js";
import type { GeoIPValidator } from "../domain/security/GeoIPValidator.js";
import type IdentityManagerService from "../../../core/IdentityManagerService/index.js";
import {
	RegisterEndpoint,
	UncommonResponse,
	type EndpointCtx,
	type SetCookie,
	type ClearCookie,
} from "../../../core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import { resolveUserAvatar } from "@common/utils/avatar.ts";
import type { AuthenticatedUser } from "../types.js";
import { UserAuthenticationResult } from "../../../core/IdentityManagerService/dao/users.ts";
import { User } from "@common/types/identity/User.js";
import type { Permission } from "@common/types/identity/Permission.js";
import { SystemRole } from "../../../core/IdentityManagerService/defaults/systemRoles.js";

/** Nombre de las cookies */
const ACCESS_COOKIE_NAME = "access_token";
const REFRESH_COOKIE_NAME = "refresh_token";

interface AuthEndpointsDeps {
	keyStore: KeyStore;
	tokenService: TokenService;
	refreshTokenRepo: RefreshTokenRepository;
	loginTracker: LoginAttemptTracker;
	geoValidator: GeoIPValidator;
	identityService: IdentityManagerService | null;
	internalIdentity: ReturnType<IdentityManagerService["_internal"]> | null;
	cookieDomain: string;
	defaultRedirectUrl: string;
	logger: { logError: (msg: string) => void; logWarn: (msg: string) => void };
}

interface LoginBody {
	username?: string;
	password?: string;
	orgId?: string;
}

interface RegisterBody {
	username?: string;
	email?: string;
	password?: string;
}

/**
 * Endpoints de autenticación nativa (usuario/contraseña)
 * Singleton con métodos estáticos y @RegisterEndpoint
 */
export class AuthEndpoints {
	private static deps: AuthEndpointsDeps;
	private static validateCredentials: (username: string, password: string) => Promise<UserAuthenticationResult>;

	static init(deps: AuthEndpointsDeps, validateCredentials: (username: string, password: string) => Promise<UserAuthenticationResult>): void {
		AuthEndpoints.deps ??= deps;
		AuthEndpoints.validateCredentials ??= validateCredentials;
	}

	/**
	 * POST /api/auth/login - Login con usuario/contraseña
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/login",
		permissions: [],
		options: { skipIdempotency: true, rateLimit: { max: 4, timeWindow: 300_000 } },
	})
	static async handleNativeLogin(ctx: EndpointCtx<Record<string, string>, LoginBody>): Promise<unknown> {
		const { username, password, orgId } = ctx.data || {};

		if (!username || !password) {
			throw new AuthError(400, "MISSING_CREDENTIALS", "Username y password son requeridos");
		}

		try {
			const profile = await AuthEndpoints.validateCredentials(username, password);
			if (!profile) throw new AuthError(401, "INVALID_CREDENTIALS", "Credenciales inválidas");
			if ("isActive" in profile && profile.isActive === false) {
				throw new AuthError(403, "ACCOUNT_DISABLED", "Cuenta desactivada");
			}
			if ("wrongPassword" in profile && profile.wrongPassword) {
				const blockStatus = await AuthEndpoints.deps.loginTracker.recordLoginAttempt(profile.id, false, ctx.ip);

				if (blockStatus.blocked) {
					if (blockStatus.permanent) {
						throw new AuthError(403, "ACCOUNT_BLOCKED_PERMANENT", "Cuenta bloqueada");
					}

					throw new AuthError(403, "ACCOUNT_BLOCKED_TEMP", "Cuenta bloqueada temporalmente", {
						blockedUntil: blockStatus.blockedUntil ?? undefined,
					});
				}

				throw new AuthError(401, "INVALID_CREDENTIALS", "Credenciales inválidas");
			}

			const fullUser = profile as User;

			// Si el usuario tiene organizaciones y no se especificó orgId (undefined = no ha elegido),
			// retornar la lista de orgs para que el frontend muestre el selector.
			// orgId === null significa "acceso personal" (elección explícita sin organización).
			if (fullUser.orgMemberships?.length && orgId === undefined) {
				const orgOptions = await AuthEndpoints.getUserOrgOptions(fullUser);
				throw UncommonResponse.json({
					success: true,
					requiresOrgSelection: true,
					userId: fullUser.id,
					username: fullUser.username,
					orgOptions,
				});
			}

			// Construir usuario directamente desde profile (ya validado por authenticate)
			const user = await AuthEndpoints.buildAuthenticatedUser("platform", fullUser, orgId);
			const cookies = await AuthEndpoints.getTokenCookies(ctx, user);

			throw UncommonResponse.json(
				{
					success: true,
					user: {
						id: user.id,
						username: user.username,
						avatar: user.avatar,
						email: user.email,
						orgId: user.orgId,
						orgSlug: user.orgId ? await AuthEndpoints.resolveOrgSlug(user.orgId) : undefined,
					},
				},
				{ cookies }
			);
		} catch (err: any) {
			if (err instanceof AuthError || err instanceof UncommonResponse) throw err;
			AuthEndpoints.deps.logger.logError(`Error en login nativo: ${err.message}`);
			throw new AuthError(500, "AUTH_ERROR", "Error durante la autenticación");
		}
	}

	/**
	 * POST /api/auth/register - Registro de nuevo usuario
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/register",
		permissions: [],
		options: { rateLimit: { max: 2, timeWindow: 3_600_000 } },
	})
	static async handleRegister(ctx: EndpointCtx<Record<string, string>, RegisterBody>): Promise<unknown> {
		const { username, email, password } = ctx.data || {};

		if (!username || !email || !password) {
			throw new AuthError(400, "MISSING_FIELDS", "Username, email y password son requeridos");
		}

		// Validaciones básicas
		if (username.length < 3 || username.length > 30) {
			throw new AuthError(400, "INVALID_USERNAME", "El nombre de usuario debe tener entre 3 y 30 caracteres");
		}

		if (password.length < 8) {
			throw new AuthError(400, "WEAK_PASSWORD", "La contraseña debe tener al menos 8 caracteres");
		}

		const emailRegex = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
		if (!emailRegex.test(email)) {
			throw new AuthError(400, "INVALID_EMAIL", "El email no es válido");
		}

		if (!AuthEndpoints.deps.internalIdentity) {
			throw new AuthError(500, "SERVICE_UNAVAILABLE", "Servicio de identidad no disponible");
		}

		try {
			// Verificar si el usuario o email ya existe (una sola query)
			const users = AuthEndpoints.deps.internalIdentity.users;
			const existing = await users.existsByUsernameOrEmail(username, email);

			if (existing.exists) {
				if (existing.field === "username") {
					throw new AuthError(409, "USERNAME_EXISTS", "El nombre de usuario ya está en uso");
				}
				throw new AuthError(409, "EMAIL_EXISTS", "El email ya está registrado");
			}

			// Crear usuario
			const newUser = await users.createUser(username, password, []);

			// Actualizar con email
			await users.updateUser(newUser.id, {
				email,
				metadata: {
					createdVia: "platform",
					createdAt: new Date().toISOString(),
				},
			});

			// Construir usuario directamente (ya tenemos todos los datos)
			const user = await AuthEndpoints.buildAuthenticatedUser("platform", {
				id: newUser.id,
				username,
				email,
			});

			// Emitir tokens (login automático tras registro)
			const cookies = await AuthEndpoints.getTokenCookies(ctx, user);

			throw UncommonResponse.json(
				{
					success: true,
					user: {
						id: user.id,
						username: user.username,
						email: user.email,
					},
				},
				{ cookies }
			);
		} catch (err: any) {
			if (err instanceof AuthError || err instanceof UncommonResponse) throw err;
			AuthEndpoints.deps.logger.logError(`Error en registro: ${err.message}`);
			throw new AuthError(500, "REGISTER_ERROR", "Error al crear la cuenta");
		}
	}

	/**
	 * GET /api/auth/session - Verificar sesión actual
	 */
	@RegisterEndpoint({
		method: "GET",
		url: "/api/auth/session",
		permissions: [],
	})
	static async handleSession(ctx: EndpointCtx): Promise<unknown> {
		const token = ctx.cookies?.[ACCESS_COOKIE_NAME];

		if (!token) {
			throw new AuthError(401, "NO_SESSION", "No hay sesión activa");
		}

		const result = await AuthEndpoints.deps.tokenService.verifyAccessToken(token);

		if (!result.valid || !result.session) {
			throw new AuthError(401, "INVALID_SESSION", result.error || "Sesión inválida");
		}

		const headers: Record<string, string> = {};
		if (result.usedPreviousKey) {
			headers["X-Refresh-Required"] = "true";
		}

		const orgSlug = result.session.user.orgId ? await AuthEndpoints.resolveOrgSlug(result.session.user.orgId) : undefined;

		// Enriquecer sesión con datos de identity (perms bitfield, flags admin, groupIds).
		// Se hace best-effort: si IdentityManagerService no está disponible, se devuelven defaults vacíos
		// y la sesión sigue siendo válida (no se rompe la autenticación).
		const sessionExtras = await AuthEndpoints.buildSessionExtras(result.session.user.id, result.session.user.orgId);

		const userPayload = {
			id: result.session.user.id,
			username: result.session.user.username,
			email: result.session.user.email,
			avatar: result.session.user.avatar,
			provider: result.session.user.provider,
			orgId: result.session.user.orgId,
			orgSlug,
			perms: sessionExtras.perms,
			isAdmin: sessionExtras.isAdmin,
			isOrgAdmin: sessionExtras.isOrgAdmin,
			groupIds: sessionExtras.groupIds,
		};

		// Si hay headers especiales, usar UncommonResponse
		if (Object.keys(headers).length > 0) {
			throw UncommonResponse.json(
				{
					authenticated: true,
					user: userPayload,
					expiresAt: result.session.expiresAt,
				},
				{ headers }
			);
		}

		return {
			authenticated: true,
			user: userPayload,
			expiresAt: result.session.expiresAt,
		};
	}

	/**
	 * POST /api/auth/refresh - Refrescar tokens
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/refresh",
		permissions: [],
		options: { skipIdempotency: true, rateLimit: { max: 20, timeWindow: 60_000 } },
	})
	static async handleRefresh(ctx: EndpointCtx): Promise<never> {
		const refreshToken = ctx.cookies?.[REFRESH_COOKIE_NAME];

		if (!refreshToken) {
			throw new AuthError(401, "NO_REFRESH_TOKEN", "No hay refresh token");
		}

		const storedToken = await AuthEndpoints.deps.refreshTokenRepo.findByToken(refreshToken);

		if (!storedToken) {
			throw new AuthError(401, "INVALID_REFRESH_TOKEN", "Refresh token inválido");
		}

		// Validar cambio de país usando Cloudflare headers
		const currentCountry = AuthEndpoints.deps.geoValidator.getCountryFromHeaders(ctx.headers);
		const geoValidation = AuthEndpoints.deps.geoValidator.validateLocationChange(currentCountry, storedToken.country);

		if (!geoValidation.valid) {
			await AuthEndpoints.deps.tokenService.revokeAllUserTokens(storedToken.userId);
			AuthEndpoints.deps.logger.logWarn(`Cambio de país detectado para usuario ${storedToken.userId}: ${geoValidation.reason}`);

			throw new AuthError(401, "LOCATION_CHANGE", "Sesión invalidada por cambio de ubicación", {
				requireRelogin: true,
			});
		}

		const refreshAttempt = await AuthEndpoints.deps.loginTracker.recordRefreshAttempt(storedToken.userId, true);

		if (refreshAttempt.blocked) {
			if (refreshAttempt.shouldDeleteTokens) {
				await AuthEndpoints.deps.tokenService.deleteAllUserTokens(storedToken.userId);
			}

			throw new AuthError(403, "ACCOUNT_BLOCKED", "Cuenta bloqueada por actividad sospechosa", {
				permanent: refreshAttempt.status.permanent,
			});
		}

		const ipAddress = AuthEndpoints.deps.geoValidator.extractRealIP(ctx.headers, ctx.ip);
		const result = await AuthEndpoints.deps.tokenService.refreshTokens(
			refreshToken,
			ipAddress,
			currentCountry,
			ctx.headers["user-agent"]?.toString() || "unknown",
			async (userId: string) => AuthEndpoints.getUserById(userId)
		);

		if (!result.success || !result.tokens) {
			const failResult = await AuthEndpoints.deps.loginTracker.recordRefreshAttempt(storedToken.userId, false);

			if (failResult.blocked && failResult.shouldDeleteTokens) {
				await AuthEndpoints.deps.tokenService.deleteAllUserTokens(storedToken.userId);
			}

			throw new AuthError(401, "REFRESH_FAILED", result.error || "Error al refrescar tokens");
		}

		const cookies = AuthEndpoints.buildTokenCookies(result.tokens.accessToken, result.tokens.refreshToken.token);
		throw UncommonResponse.json({ success: true }, { cookies });
	}

	/**
	 * POST /api/auth/switch-org - Cambiar contexto de organización
	 * Re-emite tokens con el nuevo orgId
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/switch-org",
		permissions: [],
		options: { skipIdempotency: true, rateLimit: { max: 20, timeWindow: 60_000 } },
	})
	static async handleSwitchOrg(ctx: EndpointCtx<Record<string, string>, { orgId?: string }>): Promise<never> {
		const token = ctx.cookies?.[ACCESS_COOKIE_NAME];
		if (!token) {
			throw new AuthError(401, "NO_SESSION", "No hay sesión activa");
		}

		const result = await AuthEndpoints.deps.tokenService.verifyAccessToken(token);
		if (!result.valid || !result.session) {
			throw new AuthError(401, "INVALID_SESSION", "Sesión inválida");
		}

		const userId = result.session.user.id;
		const newOrgId = ctx.data?.orgId || undefined;

		// Validar que el usuario pertenece a la org (si se especificó)
		if (newOrgId && AuthEndpoints.deps.internalIdentity) {
			const user = await AuthEndpoints.deps.internalIdentity.users.getUser(userId);
			if (!user) throw new AuthError(404, "USER_NOT_FOUND", "Usuario no encontrado");
			const isMember = user.orgMemberships?.some((m) => m.orgId === newOrgId);
			if (!isMember) {
				throw new AuthError(403, "NOT_ORG_MEMBER", "No perteneces a esta organización");
			}
		}

		// Re-construir usuario con nuevo orgId y permisos actualizados
		const updatedUser = await AuthEndpoints.getUserById(userId);
		if (!updatedUser) throw new AuthError(404, "USER_NOT_FOUND", "Usuario no encontrado");

		// Re-resolver permisos con el nuevo orgId
		const permissions = await AuthEndpoints.getUserPermissions(userId, newOrgId);
		updatedUser.permissions = permissions;
		updatedUser.orgId = newOrgId;

		const cookies = await AuthEndpoints.getTokenCookies(ctx, updatedUser);

		const orgSlug = newOrgId ? await AuthEndpoints.resolveOrgSlug(newOrgId) : undefined;
		throw UncommonResponse.json(
			{
				success: true,
				user: {
					id: updatedUser.id,
					username: updatedUser.username,
					email: updatedUser.email,
					orgId: updatedUser.orgId,
					orgSlug,
				},
			},
			{ cookies }
		);
	}

	/**
	 * GET /api/auth/user-orgs - Obtener organizaciones del usuario autenticado
	 */
	@RegisterEndpoint({
		method: "GET",
		url: "/api/auth/user-orgs",
		permissions: [],
	})
	static async handleUserOrgs(ctx: EndpointCtx): Promise<unknown> {
		const token = ctx.cookies?.[ACCESS_COOKIE_NAME];
		if (!token) {
			throw new AuthError(401, "NO_SESSION", "No hay sesión activa");
		}

		const result = await AuthEndpoints.deps.tokenService.verifyAccessToken(token);
		if (!result.valid || !result.session) {
			throw new AuthError(401, "INVALID_SESSION", "Sesión inválida");
		}

		const userId = result.session.user.id;
		if (!AuthEndpoints.deps.internalIdentity) {
			return { orgs: [], currentOrgId: result.session.user.orgId };
		}

		const user = await AuthEndpoints.deps.internalIdentity.users.getUser(userId);
		if (!user) return { orgs: [], currentOrgId: result.session.user.orgId };

		const orgOptions = await AuthEndpoints.getUserOrgOptions(user);
		return {
			orgs: orgOptions,
			currentOrgId: result.session.user.orgId,
		};
	}

	/**
	 * POST /api/auth/logout - Cerrar sesión
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/logout",
		permissions: [],
		options: { skipIdempotency: true, rateLimit: { max: 3, timeWindow: 60_000 } },
	})
	static async handleLogout(ctx: EndpointCtx): Promise<never> {
		const refreshToken = ctx.cookies?.[REFRESH_COOKIE_NAME];

		if (refreshToken) {
			await AuthEndpoints.deps.refreshTokenRepo.revoke(refreshToken);
		}

		const clearCookies: ClearCookie[] = [
			{ name: ACCESS_COOKIE_NAME, options: { path: "/", domain: AuthEndpoints.deps.cookieDomain } },
			{ name: REFRESH_COOKIE_NAME, options: { path: "/api/auth/refresh", domain: AuthEndpoints.deps.cookieDomain } },
		];

		throw UncommonResponse.json({ success: true, message: "Sesión cerrada" }, { clearCookies });
	}

	// ============ Métodos auxiliares (privados estáticos) ============

	private static async getTokenCookies(ctx: EndpointCtx, user: AuthenticatedUser): Promise<SetCookie[]> {
		const ipAddress = AuthEndpoints.deps.geoValidator.extractRealIP(ctx.headers, ctx.ip);
		const country = AuthEndpoints.deps.geoValidator.getCountryFromHeaders(ctx.headers);
		const deviceId = AuthEndpoints.generateDeviceId(ctx.headers);
		const userAgent = ctx.headers["user-agent"]?.toString() || "unknown";

		const tokens = await AuthEndpoints.deps.tokenService.createTokenPair(user, deviceId, ipAddress, country, userAgent);
		return AuthEndpoints.buildTokenCookies(tokens.accessToken, tokens.refreshToken.token);
	}

	private static buildTokenCookies(accessToken: string, refreshToken: string): SetCookie[] {
		const accessConfig = AuthEndpoints.deps.tokenService.getAccessCookieConfig();
		const refreshConfig = AuthEndpoints.deps.tokenService.getRefreshCookieConfig();

		return [
			{
				name: accessConfig.name,
				value: accessToken,
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
				value: refreshToken,
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

	private static async getUserById(userId: string): Promise<AuthenticatedUser | null> {
		if (!AuthEndpoints.deps.internalIdentity) return null;

		try {
			const user = await AuthEndpoints.deps.internalIdentity.users.getUser(userId);
			if (!user) return null;

			// Resolve avatar usando el helper compartido (perfil → metadata → linkedAccounts)
			const avatar = resolveUserAvatar(user);

			const permissions = await AuthEndpoints.getUserPermissions(userId);
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

	/**
	 * Construye AuthenticatedUser a partir de un perfil ya validado.
	 * Resuelve avatar con la misma lógica que getUserById:
	 *   profile.avatar → metadata.avatar → linkedAccounts providerAvatar
	 */
	private static async buildAuthenticatedUser(
		provider: string,
		profile: {
			id: string;
			username: string;
			email?: string;
			avatar?: string;
			metadata?: Record<string, unknown>;
			linkedAccounts?: Array<{ status: string; providerAvatar?: string }>;
		},
		orgId?: string
	): Promise<AuthenticatedUser> {
		const permissions = await AuthEndpoints.getUserPermissions(profile.id, orgId);

		// Resolver avatar usando el helper compartido (perfil → metadata → linkedAccounts)
		const avatar = resolveUserAvatar(profile);

		return {
			id: profile.id,
			providerId: profile.id,
			provider,
			username: profile.username,
			email: profile.email,
			avatar,
			permissions,
			orgId,
		};
	}

	private static async getUserPermissions(userId: string, orgId?: string): Promise<string[]> {
		if (!AuthEndpoints.deps.identityService) return ["public.read"];

		try {
			const permissions = AuthEndpoints.deps.identityService.permissions;
			const resolved = await permissions.resolvePermissions(userId, orgId);
			return resolved.map((p: { resource: string; scope: number; action: number }) => `${p.resource}.${p.scope}.${p.action}`);
		} catch {
			return ["public.read"];
		}
	}

	/**
	 * Resuelve el slug de una organización a partir de su ID
	 */
	private static async resolveOrgSlug(orgId: string): Promise<string | undefined> {
		if (!AuthEndpoints.deps.internalIdentity) return undefined;
		try {
			const org = await AuthEndpoints.deps.internalIdentity.organizations.getOrganization(orgId);
			return org?.slug;
		} catch {
			return undefined;
		}
	}

	/**
	 * Obtiene las opciones de organización para un usuario
	 */
	private static async getUserOrgOptions(user: User): Promise<{ orgId: string; slug: string }[]> {
		if (!AuthEndpoints.deps.internalIdentity || !user.orgMemberships?.length) return [];

		const orgOptions: { orgId: string; slug: string }[] = [];
		for (const membership of user.orgMemberships) {
			try {
				const org = await AuthEndpoints.deps.internalIdentity.organizations.getOrganization(membership.orgId);
				if (org?.status === "active") {
					orgOptions.push({ orgId: org.orgId, slug: org.slug });
				}
			} catch {
				/* org no encontrada */
			}
		}
		return orgOptions;
	}

	/**
	 * Construye los campos extra del payload de sesión (`perms`, `isAdmin`, `isOrgAdmin`, `groupIds`)
	 * consultando IdentityManagerService. Si no está disponible o falla la lectura, devuelve defaults
	 * vacíos para no romper la respuesta de /session.
	 */
	private static async buildSessionExtras(
		userId: string,
		orgId?: string
	): Promise<{ perms: Permission[]; isAdmin: boolean; isOrgAdmin: boolean; groupIds: string[] }> {
		const empty = { perms: [] as Permission[], isAdmin: false, isOrgAdmin: false, groupIds: [] as string[] };
		const identity = AuthEndpoints.deps.identityService;
		const internal = AuthEndpoints.deps.internalIdentity;
		if (!identity || !internal) return empty;

		try {
			const [resolved, user] = await Promise.all([identity.permissions.resolvePermissions(userId, orgId), internal.users.getUser(userId)]);

			const perms: Permission[] = resolved.map((p) => ({ resource: p.resource, action: p.action, scope: p.scope }));

			const [hasGlobalAdminRole, isOrgAdmin] = await Promise.all([
				AuthEndpoints.hasGlobalAdminRole(user),
				AuthEndpoints.isOrgAdmin(user, orgId),
			]);

			return {
				perms,
				isAdmin: !orgId && hasGlobalAdminRole,
				isOrgAdmin,
				groupIds: user?.groupIds ?? [],
			};
		} catch {
			return empty;
		}
	}

	/** True si el usuario tiene un rol global con name=SystemRole.ADMIN (sin orgId). */
	private static async hasGlobalAdminRole(user: User | null): Promise<boolean> {
		const internal = AuthEndpoints.deps.internalIdentity;
		if (!internal || !user?.roleIds?.length) return false;

		for (const roleId of user.roleIds) {
			const role = await internal.roles.getRole(roleId);
			if (role?.name === SystemRole.ADMIN && !role.orgId) return true;
		}
		return false;
	}

	/** True si el usuario es Admin dentro de la org activa (vía orgMembership). */
	private static async isOrgAdmin(user: User | null, orgId: string | undefined): Promise<boolean> {
		const internal = AuthEndpoints.deps.internalIdentity;
		if (!internal || !orgId || !user?.orgMemberships?.length) return false;

		const membership = user.orgMemberships.find((m) => m.orgId === orgId);
		if (!membership?.roleIds?.length) return false;

		for (const roleId of membership.roleIds) {
			const role = await internal.roles.getRole(roleId);
			if (role?.name === SystemRole.ADMIN) return true;
		}
		return false;
	}
}
