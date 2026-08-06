import type { KeyStore } from "../domain/keys/KeyStore.js";
import type { TokenService } from "../domain/tokens/TokenService.js";
import type { RefreshTokenRepository } from "../domain/tokens/RefreshTokenRepository.js";
import type { LoginAttemptTracker } from "../domain/security/LoginAttemptTracker.js";
import type { GeoIPValidator } from "../domain/security/GeoIPValidator.js";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";
import {
	RegisterEndpoint,
	UncommonResponse,
	type EndpointCtx,
	type SetCookie,
	type ClearCookie,
} from "../../../core/EndpointManagerService/index.js";
import * as AS from "./schemas/auth.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import { resolveUserAvatar } from "@common/utils/avatar.ts";
import type { AuthenticatedUser, ModerationLookupService } from "../types.js";
import { UserAuthenticationResult } from "../../../core/IdentityManagerService/dao/users.ts";
import { User } from "@common/types/identity/User.js";
import type { Permission } from "@common/types/identity/Permission.js";
import { SystemRole } from "../../../core/IdentityManagerService/defaults/systemRoles.js";
import { assertEmailNotBanned, assertIpNotBanned, recordLoginAttemptIp, redirectIfRequestBanned } from "../utils/moderationGuards.js";
import { assertOrgMembership, requiresOrgSelection, resolveNativeLoginUser, validateNativeLoginBody, type NativeLoginBody } from "../utils/nativeLogin.js";
import { checkUsername } from "@common/utils/name-policy.js";
import { buildLegalAcceptance, currentLegalVersions } from "@common/utils/legal-docs.js";

/** Nombre de las cookies */
const ACCESS_COOKIE_NAME = "access_token";
const REFRESH_COOKIE_NAME = "refresh_token";

interface AuthEndpointsDeps {
	keyStore: KeyStore;
	tokenService: TokenService;
	refreshTokenRepo: RefreshTokenRepository;
	loginTracker: LoginAttemptTracker;
	geoValidator: GeoIPValidator;
	identityService: IIdentityManagerService | null;
	internalIdentity: ReturnType<IIdentityManagerService["_internal"]> | null;
	cookieDomain: string;
	defaultRedirectUrl: string;
	logger: { logError: (msg: string) => void; logWarn: (msg: string) => void };
	moderation: ModerationLookupService | null;
	/** Hook tras un login exitoso: detecta dispositivo/IP nuevo y notifica (best-effort). */
	onLoginSuccess?: (userId: string, ip: string) => void;
	/** Hook cuando se detecta reuso de un refresh token (posible robo) y se revoca su familia. */
	onTokenReuse?: (userId: string) => void;
}

interface LegalAcceptanceBody {
	acceptedTerms?: boolean;
	ageConfirmed?: boolean;
	termsVersion?: string;
	privacyVersion?: string;
}

interface RegisterBody {
	username?: string;
	email?: string;
	password?: string;
	legal?: LegalAcceptanceBody;
}

interface ValidRegisterBody {
	username: string;
	email: string;
	password: string;
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
		options: {
			tag: "SessionManagerService/Auth",
			summary: "Login con usuario/contraseña",
			description: "Autentica con credenciales nativas. Si el usuario pertenece a organizaciones y no se envía `orgId`, devuelve `requiresOrgSelection` con las opciones.",
			skipIdempotency: true,
			rateLimit: { max: 4, timeWindow: 300_000 },
			schema: { body: AS.LoginBody, response: { 200: AS.LoginResponse } },
		},
	})
	static async handleNativeLogin(ctx: EndpointCtx<Record<string, string>, NativeLoginBody>): Promise<unknown> {
		const { username, password, orgId } = validateNativeLoginBody(ctx.data);
		const ipAddress = ctx.ip;

		// Pre-check: IP baneada -> rechazar antes de revelar si las credenciales son válidas
		await assertIpNotBanned(AuthEndpoints.deps.moderation, ipAddress);

		try {
			const profile = await AuthEndpoints.validateCredentials(username, password);
			const fullUser = await resolveNativeLoginUser(profile, AuthEndpoints.deps.loginTracker, ipAddress);

			// Post-credenciales: chequear ban por email
			await assertEmailNotBanned(AuthEndpoints.deps.moderation, fullUser.email);

			// Registrar IP de login exitoso (3h) para alimentar la ban-list anti-evasión
			await recordLoginAttemptIp(AuthEndpoints.deps.moderation, fullUser.id, ipAddress, AuthEndpoints.deps.logger);
			// Detección de dispositivo/IP nuevo → notificación de seguridad (fire-and-forget).
			AuthEndpoints.deps.onLoginSuccess?.(fullUser.id, ipAddress);

			// Si el usuario tiene organizaciones y no se especificó orgId (undefined = no ha elegido),
			// retornar la lista de orgs para que el frontend muestre el selector.
			// orgId === null significa "acceso personal" (elección explícita sin organización).
			if (requiresOrgSelection(fullUser, orgId)) {
				await AuthEndpoints.respondWithOrgSelection(fullUser);
			}

			// El orgId llega del cliente: sin esta comprobación cualquiera se emitiría
			// un token con el contexto de una organización ajena (mismo chequeo que
			// hace `switch-org`).
			assertOrgMembership(fullUser, orgId);

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
		options: {
			tag: "SessionManagerService/Auth",
			summary: "Registro de nuevo usuario",
			description: "Crea una cuenta nativa y emite tokens (login automático). Reglas de negocio adicionales en validateRegisterBody.",
			rateLimit: { max: 2, timeWindow: 3_600_000 },
			// Validación declarativa (TypeBox): tipos/formatos antes del handler.
			schema: { body: AS.RegisterBody, response: { 200: AS.RegisterResponse } },
		},
	})
	static async handleRegister(ctx: EndpointCtx<Record<string, string>, RegisterBody>): Promise<unknown> {
		const { username, email, password } = AuthEndpoints.validateRegisterBody(ctx.data);
		await redirectIfRequestBanned({
			moderation: AuthEndpoints.deps.moderation,
			email,
			ip: ctx.ip,
			emailReason: "Email no permitido",
		});

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

			// Actualizar con email. La constancia legal se sella en el servidor: qué versión de cada
			// documento estaba vigente y cuándo se aceptó. Sin esto, la casilla no prueba nada.
			await users.updateUser(newUser.id, {
				email,
				metadata: {
					createdVia: "platform",
					createdAt: new Date().toISOString(),
					legalAcceptance: buildLegalAcceptance("register-form", true),
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
		options: {
			tag: "SessionManagerService/Auth",
			summary: "Verifica la sesión actual",
			description: "Valida la cookie de acceso y devuelve el usuario enriquecido (perms bitfield, isAdmin, isOrgAdmin, groupIds).",
			rateLimit: { max: 120, timeWindow: 60_000 },
			schema: { response: { 200: AS.SessionResponse } },
		},
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

		// Enriquecer sesión con datos frescos de identity (avatar, perms bitfield, flags admin, groupIds).
		// Se hace best-effort: si IIdentityManagerService no está disponible, se devuelven defaults vacíos
		// y la sesión sigue siendo válida (no se rompe la autenticación).
		const sessionExtras = await AuthEndpoints.buildSessionExtras(result.session.user.id, result.session.user.orgId);
		const freshAvatar = sessionExtras.hasFreshUser ? sessionExtras.avatar : result.session.user.avatar;

		const userPayload = {
			id: result.session.user.id,
			username: result.session.user.username,
			email: result.session.user.email,
			avatar: freshAvatar,
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
		options: {
			tag: "SessionManagerService/Auth",
			summary: "Refresca los tokens de sesión",
			description: "Rota access/refresh tokens validando cambios de ubicación (geo) y actividad sospechosa.",
			skipIdempotency: true,
			rateLimit: { max: 20, timeWindow: 60_000 },
			schema: { response: { 200: AS.RefreshResponse } },
		},
	})
	static async handleRefresh(ctx: EndpointCtx): Promise<never> {
		const refreshToken = ctx.cookies?.[REFRESH_COOKIE_NAME];

		if (!refreshToken) {
			throw new AuthError(401, "NO_REFRESH_TOKEN", "No hay refresh token");
		}

		// Acepta el token ya rotado dentro de la ventana de gracia: con apps federadas en
		// orígenes distintos, dos pestañas pueden renovar a la vez y ninguna es fraudulenta.
		const resolved = await AuthEndpoints.deps.refreshTokenRepo.resolveCurrent(refreshToken);

		if (!resolved) {
			// Detección de reuso (ADC-04): un refresh token ya rotado y presentado fuera de la
			// ventana de gracia es la señal canónica de robo (OAuth 2.0 Security BCP §4.14.2).
			// En vez de un 401 seco —que dejaría viva la sesión del atacante— se revoca TODA la
			// familia del usuario (contención) y se le avisa.
			const replay = await AuthEndpoints.deps.refreshTokenRepo.detectReplayedToken(refreshToken);
			if (replay) {
				await AuthEndpoints.deps.tokenService.revokeAllUserTokens(replay.userId);
				AuthEndpoints.deps.logger.logWarn(`Reuso de refresh token detectado para ${replay.userId}: familia de tokens revocada`);
				AuthEndpoints.deps.onTokenReuse?.(replay.userId);
				throw new AuthError(401, "TOKEN_REUSE_DETECTED", "Sesión invalidada por seguridad", { requireRelogin: true });
			}
			throw new AuthError(401, "INVALID_REFRESH_TOKEN", "Refresh token inválido");
		}

		const storedToken = resolved.stored;

		// Validar cambio de país usando Cloudflare headers
		const currentCountry = AuthEndpoints.deps.geoValidator.getCountryFromHeaders(ctx.headers, ctx.viaTrustedProxy);
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

		const ipAddress = ctx.ip;
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
		// `expiresAt` viaja en el cuerpo para que el cliente programe la próxima renovación
		// sin tener que pedir `/session` ni leer la cookie (es HttpOnly).
		throw UncommonResponse.json({ success: true, expiresAt: result.expiresAt }, { cookies });
	}

	/**
	 * POST /api/auth/switch-org - Cambiar contexto de organización
	 * Re-emite tokens con el nuevo orgId
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/switch-org",
		permissions: [],
		options: {
			tag: "SessionManagerService/Auth",
			summary: "Cambia el contexto de organización",
			description: "Re-emite tokens con el nuevo `orgId` (o acceso personal). Valida la pertenencia a la organización.",
			skipIdempotency: true,
			rateLimit: { max: 20, timeWindow: 60_000 },
			schema: { body: AS.SwitchOrgBody, response: { 200: AS.SwitchOrgResponse } },
		},
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
			assertOrgMembership(user, newOrgId);
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
		options: {
			tag: "SessionManagerService/Auth",
			summary: "Organizaciones del usuario autenticado",
			schema: { response: { 200: AS.UserOrgsResponse } },
		},
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
		options: {
			tag: "SessionManagerService/Auth",
			summary: "Cierra la sesión",
			description: "Revoca el refresh token y limpia las cookies de sesión.",
			skipIdempotency: true,
			rateLimit: { max: 3, timeWindow: 60_000 },
			schema: { response: { 200: AS.LogoutResponse } },
		},
	})
	static async handleLogout(ctx: EndpointCtx): Promise<never> {
		await AuthEndpoints.revokeCurrentSession(ctx);

		const clearCookies: ClearCookie[] = [
			{ name: ACCESS_COOKIE_NAME, options: { path: "/", domain: AuthEndpoints.deps.cookieDomain } },
			{ name: REFRESH_COOKIE_NAME, options: { path: "/api/auth/refresh", domain: AuthEndpoints.deps.cookieDomain } },
		];

		throw UncommonResponse.json({ success: true, message: "Sesión cerrada" }, { clearCookies });
	}

	// ============ Métodos auxiliares (privados estáticos) ============

	/**
	 * Revoca el refresh token de ESTA sesión (no la de los demás dispositivos del usuario).
	 *
	 * La cookie del refresh está acotada a `path=/api/auth/refresh`, así que el navegador no la
	 * manda a este endpoint; y borrar cookies del lado del cliente no invalida nada —un token ya
	 * capturado sigue sirviendo hasta su TTL de 30 días—. La sesión se identifica con el access
	 * token, que sí llega (su cookie cuelga de `/`) y lleva dentro el `deviceId`.
	 *
	 * Best-effort a propósito: si no se puede identificar la sesión (sin token, o expirado), se
	 * limpian las cookies igual. Cerrar sesión nunca debe fallar.
	 */
	private static async revokeCurrentSession(ctx: EndpointCtx): Promise<void> {
		const { refreshTokenRepo, tokenService, logger } = AuthEndpoints.deps;

		// Si por lo que sea llegó la cookie del refresh (cliente no-navegador), se usa directo.
		const refreshToken = ctx.cookies?.[REFRESH_COOKIE_NAME];
		if (refreshToken) {
			await refreshTokenRepo.revoke(refreshToken);
			return;
		}

		if (!ctx.token) return; // logout sin sesión: no hay nada que revocar

		const verified = await tokenService.verifyAccessToken(ctx.token);
		const userId = verified.payload?.userId;
		const deviceId = verified.payload?.deviceId;
		if (!userId || !deviceId) {
			// Access token vencido o ilegible: no hay forma de saber qué sesión cerrar.
			logger.logWarn("[logout] sesión no identificable: el refresh token sigue vivo hasta su TTL");
			return;
		}

		await refreshTokenRepo.revokeForDevice(userId, deviceId);
	}

	private static async respondWithOrgSelection(fullUser: User): Promise<never> {
		const orgOptions = await AuthEndpoints.getUserOrgOptions(fullUser);
		throw UncommonResponse.json({
			success: true,
			requiresOrgSelection: true,
			userId: fullUser.id,
			username: fullUser.username,
			orgOptions,
		});
	}

	private static validateRegisterBody(body: RegisterBody | undefined): ValidRegisterBody {
		const { username, email, password } = body || {};

		if (!username || !email || !password) {
			throw new AuthError(400, "MISSING_FIELDS", "Username, email y password son requeridos");
		}

		if (username.length < 3 || username.length > 30) {
			throw new AuthError(400, "INVALID_USERNAME", "El nombre de usuario debe tener entre 3 y 30 caracteres");
		}

		// Reservados y malas palabras (src/common/config/name-policy.json). Bloquear el username
		// bloquea también su dirección de correo, que se deriva de él. El mensaje no distingue el
		// motivo: publicar la lista no ayuda a elegir otro nombre.
		if (checkUsername(username)) {
			throw new AuthError(400, "FORBIDDEN_USERNAME", "Ese nombre de usuario no está disponible");
		}

		if (password.length < 8) {
			throw new AuthError(400, "WEAK_PASSWORD", "La contraseña debe tener al menos 8 caracteres");
		}

		const emailRegex = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
		if (!emailRegex.test(email)) {
			throw new AuthError(400, "INVALID_EMAIL", "El email no es válido");
		}

		AuthEndpoints.validateLegalAcceptance(body?.legal);

		return { username, email, password };
	}

	/**
	 * Exige la aceptación de Términos y Privacidad y la declaración de edad, y comprueba que la
	 * página que las mostró tenía las versiones vigentes.
	 *
	 * La comprobación de versión no es ceremonia: si el documento cambió mientras el formulario
	 * estaba abierto, la constancia diría que se aceptó un texto que la persona nunca vio. Ante ese
	 * caso rechazamos el alta y pedimos recargar, que es barato y deja la prueba limpia.
	 */
	private static validateLegalAcceptance(legal: LegalAcceptanceBody | undefined): void {
		if (!legal?.acceptedTerms) {
			throw new AuthError(400, "LEGAL_NOT_ACCEPTED", "Debés aceptar los Términos y Condiciones y la Política de Privacidad");
		}

		if (!legal.ageConfirmed) {
			throw new AuthError(400, "AGE_NOT_CONFIRMED", "Debés confirmar que cumplís con la edad mínima");
		}

		const current = currentLegalVersions();
		if (legal.termsVersion !== current.termsVersion || legal.privacyVersion !== current.privacyVersion) {
			throw new AuthError(
				409,
				"LEGAL_VERSION_MISMATCH",
				"Los Términos o la Política de Privacidad se actualizaron. Recargá la página para leer la versión vigente."
			);
		}
	}

	private static async getTokenCookies(ctx: EndpointCtx, user: AuthenticatedUser): Promise<SetCookie[]> {
		const ipAddress = ctx.ip;
		const country = AuthEndpoints.deps.geoValidator.getCountryFromHeaders(ctx.headers, ctx.viaTrustedProxy);
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

			// Cuenta desactivada (ban, baja voluntaria, desactivación administrativa): tratarla
			// como inexistente. Es el único punto donde `/api/auth/refresh` y `/api/auth/switch-org`
			// vuelven a mirar el estado de la cuenta; devolver null hace que `refreshTokens` revoque
			// el refresh token en vez de rotarlo, así que la sesión no se puede renovar más.
			if (user.isActive === false) {
				AuthEndpoints.deps.logger.logWarn(`Sesión rechazada: la cuenta ${userId} está desactivada`);
				return null;
			}

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
			avatar?: string | null;
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
	 * Construye los campos extra del payload de sesión (`avatar`, `perms`, `isAdmin`, `isOrgAdmin`, `groupIds`)
	 * consultando IIdentityManagerService. Si no está disponible o falla la lectura, devuelve defaults
	 * vacíos para no romper la respuesta de /session.
	 */
	private static async buildSessionExtras(
		userId: string,
		orgId?: string
	): Promise<{ avatar?: string; hasFreshUser: boolean; perms: Permission[]; isAdmin: boolean; isOrgAdmin: boolean; groupIds: string[] }> {
		const empty = {
			avatar: undefined,
			hasFreshUser: false,
			perms: [] as Permission[],
			isAdmin: false,
			isOrgAdmin: false,
			groupIds: [] as string[],
		};
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
				avatar: user ? resolveUserAvatar(user) : undefined,
				hasFreshUser: Boolean(user),
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
