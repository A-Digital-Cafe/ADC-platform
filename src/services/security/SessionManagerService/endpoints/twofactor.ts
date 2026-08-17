import type { IdentityInternalApi } from "../../../core/IdentityManagerService/internal.js";
import type RedisProvider from "../../../../providers/queue/redis/index.js";
import {
	RegisterEndpoint,
	UncommonResponse,
	type EndpointCtx,
	type SetCookie,
	type ClearCookie,
} from "../../../core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { createAtRestSealer } from "@common/utils/at-rest-envelope.ts";
import { sha256Hex } from "@common/utils/crypto.ts";
import { randomBytes } from "node:crypto";
import { pending2faEntryCheck, type Pending2faData } from "../schemas/pending-2fa.js";
import type { PendingLinkEntry } from "../utils/pendingLinks.js";
import * as TFS from "./schemas/twofactor.js";

const isProd = process.env.NODE_ENV === "production";

/** Cookie del login a medio hacer. HttpOnly: el desafío nunca queda al alcance del JS de la página. */
const PENDING_2FA_COOKIE_NAME = "adc_pending_2fa";

/**
 * Cinco minutos alcanzan para abrir el autenticador, y para el alta obligatoria también para
 * escanear el QR. Más tiempo sólo agranda la ventana en la que un login a medio hacer sirve.
 */
const PENDING_2FA_TTL_SECONDS = 5 * 60;

/** Códigos fallidos antes de tirar el desafío y obligar a rehacer el login. */
const MAX_2FA_ATTEMPTS = 5;

const REDIS_PENDING_PREFIX = "auth:pending2fa:";
const pending2faSeal = createAtRestSealer("adc:2fa-pending");

/** Sesión ya emitida por quien sabe construirla (`AuthEndpoints`), lista para responder. */
export interface IssuedSession {
	cookies: SetCookie[];
	user: {
		id: string;
		username: string;
		email?: string;
		avatar?: string | null;
		orgId?: string | null;
		orgSlug?: string;
	};
}

type SessionIssuer = (
	ctx: EndpointCtx<any, any>,
	userId: string,
	orgId: string | null | undefined,
	provider: string
) => Promise<IssuedSession>;

interface TwoFactorLoginDeps {
	redis: RedisProvider | null;
	internalIdentity: IdentityInternalApi | null;
	cookieDomain: string;
	/** Base absoluta del microfront `adc-auth`: los flujos OAuth terminan en un redirect. */
	authAppBase: string;
	logger: { logError: (msg: string) => void; logWarn: (msg: string) => void };
	issueSession: SessionIssuer;
	/** Aviso `security.two_factor_enabled` del alta obligatoria (lo emite Identity, dueño del topic). */
	notifyEnabled: (userId: string) => void;
}

interface ChallengeParams {
	userId: string;
	username: string;
	orgId: string | null;
	provider: string;
	/** Destino post-login. Viaja dentro del desafío para que el segundo paso lo devuelva. */
	returnUrl?: string;
	/**
	 * `redirect` para los flujos en los que el navegador está navegando (el callback OAuth, que no
	 * puede recibir un JSON); `json` para los que llegan por fetch desde el microfront.
	 */
	respondWith: "json" | "redirect";
	/** Cookies a limpiar al desviar el flujo (las del intercambio OAuth). */
	clearCookies?: ClearCookie[];
}

type PendingEntry = PendingLinkEntry<Pending2faData>;

/**
 * Segundo factor **dentro del login**: el tramo entre "la contraseña es correcta" y "hay sesión".
 *
 * Se apoya en un desafío pendiente en Redis con su cookie HttpOnly, igual que la vinculación de
 * cuentas OAuth, y por el mismo motivo: reenviar la contraseña en el segundo paso —como hace el
 * selector de organización— la deja dando vueltas por la memoria del cliente todo el trámite.
 *
 * Cubre dos casos con el mismo desafío. `verify`: la cuenta ya tiene segundo factor y lo tiene que
 * presentar. `enroll`: la cuenta **no** lo tiene pero le es obligatorio por su rol, y el alta ocurre
 * acá mismo — el login no avanza hasta que quede activo.
 */
export class TwoFactorLoginEndpoints {
	private static deps: TwoFactorLoginDeps;

	/** Fallback en memoria cuando no hay Redis (mismo criterio que el pending link de OAuth). */
	private static readonly pending = new Map<string, PendingEntry>();
	private static cleanupInterval: ReturnType<typeof setInterval> | null = null;

	static init(deps: TwoFactorLoginDeps): void {
		TwoFactorLoginEndpoints.deps ??= deps;

		if (!deps.redis && !TwoFactorLoginEndpoints.cleanupInterval) {
			TwoFactorLoginEndpoints.cleanupInterval = setInterval(() => {
				const now = Date.now();
				for (const [token, entry] of TwoFactorLoginEndpoints.pending) {
					if (now > entry.expiresAt) TwoFactorLoginEndpoints.pending.delete(token);
				}
			}, 60_000).unref?.() as ReturnType<typeof setInterval>;
		}
	}

	// ============ Puerta del login (la llaman auth.ts y oauth.ts) ============

	/**
	 * Corta el login si la cuenta necesita segundo factor, o vuelve sin hacer nada si no.
	 *
	 * Es obligatorio para quien ya lo activó **y** para toda cuenta con rol de administración
	 * (plataforma u organización), tenga o no tenga uno todavía. Un fallo leyendo identity NO deja
	 * pasar: la única razón para saltear el segundo factor es saber que no hace falta.
	 */
	static async assertSecondFactor(params: ChallengeParams): Promise<void> {
		const internal = TwoFactorLoginEndpoints.deps?.internalIdentity;
		if (!internal) return; // sin Identity no hay ni cuentas ni roles que proteger

		let enabled: boolean;
		let required: boolean;
		try {
			[enabled, required] = await Promise.all([internal.twoFactor.isEnabled(params.userId), internal.isAdminAccount(params.userId)]);
		} catch (err: any) {
			TwoFactorLoginEndpoints.deps.logger.logError(`No se pudo resolver el segundo factor de ${params.userId}: ${err?.message || err}`);
			throw new AuthError(503, "TWO_FACTOR_UNAVAILABLE", "No se pudo verificar la seguridad de la cuenta. Probá de nuevo en unos minutos.");
		}

		if (!enabled && !required) return;

		await TwoFactorLoginEndpoints.#startChallenge(params, enabled ? "verify" : "enroll");
	}

	static async #startChallenge(params: ChallengeParams, mode: Pending2faData["mode"]): Promise<never> {
		const token = randomBytes(32).toString("hex");
		const now = Date.now();

		await TwoFactorLoginEndpoints.#store(token, {
			data: {
				userId: params.userId,
				username: params.username,
				orgId: params.orgId,
				provider: params.provider,
				mode,
				...(params.returnUrl ? { returnUrl: params.returnUrl } : {}),
			},
			createdAt: now,
			expiresAt: now + PENDING_2FA_TTL_SECONDS * 1000,
			attempts: 0,
		});

		const cookies = [TwoFactorLoginEndpoints.#buildPendingCookie(token)];

		if (params.respondWith === "redirect") {
			const target = new URL("/two-factor", TwoFactorLoginEndpoints.deps.authAppBase);
			if (params.returnUrl) target.searchParams.set("returnUrl", params.returnUrl);
			throw UncommonResponse.redirect(target.toString(), { status: 302, cookies, clearCookies: params.clearCookies });
		}

		throw UncommonResponse.json(
			{ success: true, requires2fa: true, mode, username: params.username },
			{ cookies, clearCookies: params.clearCookies }
		);
	}

	// ============ Endpoints ============

	@RegisterEndpoint({
		method: "GET",
		url: "/api/auth/login/2fa",
		permissions: [],
		options: {
			tag: "SessionManagerService/TwoFactor",
			summary: "Estado del desafío de segundo factor pendiente",
			description:
				"Lee la cookie del login a medio hacer y devuelve qué se espera: `verify` (presentar un código) o `enroll` " +
				"(dar de alta el segundo factor ahora, porque la cuenta tiene rol de administración). 400 si no hay desafío o venció.",
			rateLimit: { max: 20, timeWindow: 60_000 },
			schema: { response: { 200: TFS.ChallengeStateResponse } },
		},
	})
	static async getChallenge(ctx: EndpointCtx): Promise<unknown> {
		const { entry } = await TwoFactorLoginEndpoints.#requireEntry(ctx);
		return {
			mode: entry.data.mode,
			username: entry.data.username,
			expiresAt: entry.expiresAt,
			attemptsLeft: MAX_2FA_ATTEMPTS - entry.attempts,
		};
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/login/2fa",
		permissions: [],
		options: {
			tag: "SessionManagerService/TwoFactor",
			summary: "Completa el login con el segundo factor",
			description:
				"Verifica un código del autenticador **o** uno de recuperación contra el desafío pendiente y emite la sesión. " +
				"Cinco códigos incorrectos consumen el desafío y obligan a rehacer el login desde la contraseña.",
			skipIdempotency: true,
			rateLimit: { max: 10, timeWindow: 300_000 },
			schema: { body: TFS.VerifyBody, response: { 200: TFS.VerifyResponse } },
		},
	})
	static async verify(ctx: EndpointCtx<Record<string, string>, { code?: string }>): Promise<never> {
		const { token, entry } = await TwoFactorLoginEndpoints.#requireEntry(ctx);
		if (entry.data.mode !== "verify") {
			throw new AuthError(409, "INVALID_PENDING_2FA", "Esta cuenta todavía tiene que dar de alta la verificación en dos pasos");
		}

		const code = (ctx.data?.code || "").trim();
		if (!code) throw new AuthError(400, "MISSING_FIELDS", "Se requiere el código");

		const internal = TwoFactorLoginEndpoints.#requireIdentity();
		const method = await internal.twoFactor.verify(entry.data.userId, code);
		if (!method) await TwoFactorLoginEndpoints.#recordFailure(token, entry);

		return TwoFactorLoginEndpoints.#completeLogin(ctx, token, entry);
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/login/2fa/enroll",
		permissions: [],
		options: {
			tag: "SessionManagerService/TwoFactor",
			summary: "Alta obligatoria del segundo factor durante el login",
			description:
				"Sólo para desafíos en modo `enroll`: la cuenta tiene rol de administración y todavía no configuró el segundo " +
				"factor, así que no puede entrar sin hacerlo. Devuelve el secreto y su URI `otpauth://` para el QR. " +
				"**No emite sesión**: eso lo hace `/enroll/confirm` contra un código real.",
			skipIdempotency: true,
			rateLimit: { max: 5, timeWindow: 300_000 },
			schema: { response: { 200: TFS.EnrollResponse } },
		},
	})
	static async startEnrollment(ctx: EndpointCtx): Promise<unknown> {
		const { entry } = await TwoFactorLoginEndpoints.#requireEnrollEntry(ctx);
		const internal = TwoFactorLoginEndpoints.#requireIdentity();

		const user = await internal.users.getUser(entry.data.userId);
		return internal.twoFactor.startEnrollment(entry.data.userId, user?.email || entry.data.username);
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/login/2fa/enroll/confirm",
		permissions: [],
		options: {
			tag: "SessionManagerService/TwoFactor",
			summary: "Confirma el alta obligatoria y entra",
			description:
				"Activa el segundo factor con un código del autenticador y, en la misma respuesta, emite la sesión y entrega los " +
				"códigos de recuperación (única vez que se muestran). Sin este paso el login no avanza.",
			skipIdempotency: true,
			rateLimit: { max: 10, timeWindow: 300_000 },
			schema: { body: TFS.VerifyBody, response: { 200: TFS.EnrollConfirmResponse } },
		},
	})
	static async confirmEnrollment(ctx: EndpointCtx<Record<string, string>, { code?: string }>): Promise<never> {
		const { token, entry } = await TwoFactorLoginEndpoints.#requireEnrollEntry(ctx);
		const internal = TwoFactorLoginEndpoints.#requireIdentity();

		let recoveryCodes: string[];
		try {
			recoveryCodes = await internal.twoFactor.confirmEnrollment(entry.data.userId, (ctx.data?.code || "").trim());
		} catch {
			// Un código malo acá gasta intento igual que en `verify`: si no, el alta obligatoria
			// sería un oráculo sin límite contra un secreto que el atacante acaba de recibir.
			await TwoFactorLoginEndpoints.#recordFailure(token, entry);
		}

		TwoFactorLoginEndpoints.deps.notifyEnabled(entry.data.userId);
		return TwoFactorLoginEndpoints.#completeLogin(ctx, token, entry, { recoveryCodes: recoveryCodes! });
	}

	// ============ Auxiliares ============

	/** Consume el desafío, emite la sesión y responde con las cookies puestas. */
	static async #completeLogin(
		ctx: EndpointCtx<any, any>,
		token: string,
		entry: PendingEntry,
		extra?: { recoveryCodes: string[] }
	): Promise<never> {
		await TwoFactorLoginEndpoints.#delete(token);

		const session = await TwoFactorLoginEndpoints.deps.issueSession(ctx, entry.data.userId, entry.data.orgId, entry.data.provider);

		throw UncommonResponse.json(
			{
				success: true,
				user: session.user,
				...(entry.data.returnUrl ? { redirectUrl: entry.data.returnUrl } : {}),
				...(extra?.recoveryCodes ? { recoveryCodes: extra.recoveryCodes } : {}),
			},
			{ cookies: session.cookies, clearCookies: [TwoFactorLoginEndpoints.#buildPendingClearCookie()] }
		);
	}

	static async #recordFailure(token: string, entry: PendingEntry): Promise<never> {
		entry.attempts++;

		if (entry.attempts >= MAX_2FA_ATTEMPTS) {
			await TwoFactorLoginEndpoints.#delete(token);
			throw new AuthError(401, "INVALID_TOTP", "Demasiados códigos incorrectos: volvé a iniciar sesión", { requireRelogin: true });
		}

		await TwoFactorLoginEndpoints.#store(token, entry);
		throw new AuthError(401, "INVALID_TOTP", `El código no es válido (${MAX_2FA_ATTEMPTS - entry.attempts} intentos restantes)`);
	}

	static async #requireEntry(ctx: EndpointCtx<any, any>): Promise<{ token: string; entry: PendingEntry }> {
		const token = ctx.cookies?.[PENDING_2FA_COOKIE_NAME];
		if (!token) throw new AuthError(400, "NO_PENDING_2FA", "No hay un inicio de sesión pendiente");

		const entry = await TwoFactorLoginEndpoints.#get(token);
		if (!entry) throw new AuthError(400, "INVALID_PENDING_2FA", "El inicio de sesión expiró o no es válido");

		if (Date.now() > entry.expiresAt) {
			await TwoFactorLoginEndpoints.#delete(token);
			throw new AuthError(400, "INVALID_PENDING_2FA", "El inicio de sesión expiró");
		}

		return { token, entry };
	}

	static async #requireEnrollEntry(ctx: EndpointCtx<any, any>): Promise<{ token: string; entry: PendingEntry }> {
		const result = await TwoFactorLoginEndpoints.#requireEntry(ctx);
		if (result.entry.data.mode !== "enroll") {
			throw new AuthError(409, "INVALID_PENDING_2FA", "Esta cuenta ya tiene la verificación en dos pasos activa");
		}
		return result;
	}

	static #requireIdentity(): IdentityInternalApi {
		const internal = TwoFactorLoginEndpoints.deps?.internalIdentity;
		if (!internal) throw new AuthError(503, "TWO_FACTOR_UNAVAILABLE", "Servicio de identidad no disponible");
		return internal;
	}

	static #buildPendingCookie(token: string): SetCookie {
		return {
			name: PENDING_2FA_COOKIE_NAME,
			value: token,
			options: {
				httpOnly: true,
				secure: isProd,
				// `lax` y no `strict`: el desafío de OAuth se planta en un redirect que viene del
				// proveedor, y `strict` no manda la cookie en esa primera navegación.
				sameSite: "lax",
				path: "/",
				domain: TwoFactorLoginEndpoints.deps.cookieDomain,
				maxAge: PENDING_2FA_TTL_SECONDS,
			},
		};
	}

	static #buildPendingClearCookie(): ClearCookie {
		return { name: PENDING_2FA_COOKIE_NAME, options: { path: "/", domain: TwoFactorLoginEndpoints.deps.cookieDomain } };
	}

	// ============ Store (Redis con fallback a Map) ============

	static async #store(token: string, entry: PendingEntry): Promise<void> {
		if (TwoFactorLoginEndpoints.deps.redis) {
			await TwoFactorLoginEndpoints.deps.redis.setex(
				`${REDIS_PENDING_PREFIX}${sha256Hex(token)}`,
				PENDING_2FA_TTL_SECONDS,
				pending2faSeal.seal(JSON.stringify(entry), TwoFactorLoginEndpoints.deps.logger)
			);
			return;
		}
		TwoFactorLoginEndpoints.pending.set(token, entry);
	}

	static async #get(token: string): Promise<PendingEntry | null> {
		if (TwoFactorLoginEndpoints.deps.redis) {
			const sealed = await TwoFactorLoginEndpoints.deps.redis.get(`${REDIS_PENDING_PREFIX}${sha256Hex(token)}`);
			return safeParseJson(pending2faSeal.open(sealed, TwoFactorLoginEndpoints.deps.logger), pending2faEntryCheck);
		}
		return TwoFactorLoginEndpoints.pending.get(token) || null;
	}

	static async #delete(token: string): Promise<void> {
		if (TwoFactorLoginEndpoints.deps.redis) {
			await TwoFactorLoginEndpoints.deps.redis.del(`${REDIS_PENDING_PREFIX}${sha256Hex(token)}`);
			return;
		}
		TwoFactorLoginEndpoints.pending.delete(token);
	}
}
