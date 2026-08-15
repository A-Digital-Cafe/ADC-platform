import { RegisterEndpoint, UncommonResponse, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { HttpError } from "@common/types/ADCCustomError.ts";
import type { IdentityInternalApi } from "../../../core/IdentityManagerService/internal.js";
import { findClient, isAllowedRedirect, isOidcEnabled, type OidcConfig } from "../domain/oidc/clients.js";
import { AuthorizationCodeStore, verifyPkce } from "../domain/oidc/codes.js";
import type { OidcSigningKeys } from "../domain/oidc/SigningKeys.js";
import * as OS from "./schemas/oidc.js";

/**
 * La plataforma como **proveedor** de identidad OpenID Connect.
 *
 * Ojo con la dirección: `endpoints/oauth.ts` es la plataforma actuando de **cliente** (entrar con
 * Discord o Google). Esto es lo contrario — otro sistema le pregunta a la plataforma quién sos. El
 * primer consumidor es el plano de control de la red privada, que no tiene usuarios propios.
 *
 * Sólo **authorization code + PKCE**: nada de implicit (deprecado), de client credentials (no hay
 * clientes de servidor) ni de registro dinámico, que sería dejar que cualquiera se anote para
 * recibir identidades.
 *
 * **Sin pantalla de consentimiento**: los clientes son de primera parte y están declarados a mano en
 * el `config.json`, así que el click no protegería de nada y enseña a aceptar sin leer. El día que
 * haya clientes de terceros, el consentimiento es obligatorio y va acá.
 */
export class OidcEndpoints {
	static config: OidcConfig;
	static keys: OidcSigningKeys;
	static codes: AuthorizationCodeStore;
	/**
	 * La superficie **interna** de identidad: la pública exige el token de quien pregunta, y acá no
	 * hay ninguno — el canje ya demostró la identidad con el código y el `code_verifier`.
	 */
	static identity: IdentityInternalApi | null = null;
	static logger: { logWarn(msg: string): void; logInfo(msg: string): void };

	static #assertEnabled(): void {
		if (!isOidcEnabled(OidcEndpoints.config)) {
			throw new HttpError(
				404,
				"OIDC_DISABLED",
				"El proveedor de identidad de la plataforma no está configurado (falta `ADC_OIDC_ISSUER` o no hay clientes declarados)."
			);
		}
	}

	// ── Descubrimiento ────────────────────────────────────────────────────────────

	/**
	 * Con el emisor alcanza: de acá el consumidor saca las seis URLs. Va en la ruta canónica
	 * (`/.well-known/openid-configuration` en la raíz del emisor), que es donde los clientes la buscan.
	 */
	@RegisterEndpoint({
		method: "GET",
		url: "/.well-known/openid-configuration",
		permissions: [],
		options: {
			tag: "SessionManagerService/OIDC",
			summary: "Descubrimiento OpenID Connect de la plataforma",
			description:
				"Documento de descubrimiento estándar. Es lo que se le pasa a un consumidor (por ejemplo el plano de control de la " +
				"red privada) para que resuelva solo el resto de los endpoints. Público y sin autenticación, como manda la spec.",
			schema: { response: { 200: OS.DiscoveryResponse } },
		},
	})
	static discovery() {
		OidcEndpoints.#assertEnabled();
		const { issuer } = OidcEndpoints.config;
		return {
			issuer,
			authorization_endpoint: `${issuer}/api/oidc/authorize`,
			token_endpoint: `${issuer}/api/oidc/token`,
			userinfo_endpoint: `${issuer}/api/oidc/userinfo`,
			jwks_uri: `${issuer}/api/oidc/jwks`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code"],
			subject_types_supported: ["public"],
			id_token_signing_alg_values_supported: ["RS256"],
			scopes_supported: ["openid", "profile", "email"],
			token_endpoint_auth_methods_supported: ["none"],
			code_challenge_methods_supported: ["S256"],
			claims_supported: ["sub", "iss", "aud", "exp", "iat", "email", "email_verified", "name", "preferred_username"],
		};
	}

	/** Las claves públicas con las que se verifica lo que este emisor firma. Nunca la privada. */
	@RegisterEndpoint({
		method: "GET",
		url: "/api/oidc/jwks",
		permissions: [],
		options: {
			tag: "SessionManagerService/OIDC",
			summary: "Claves públicas de firma (JWKS)",
			description:
				"Publica la clave actual y la anterior, cada una con su `kid`. Que estén las dos es lo que permite rotar sin " +
				"invalidar los tokens en vuelo: el consumidor elige por `kid`.",
			schema: { response: { 200: OS.JwksResponse } },
		},
	})
	static jwks() {
		OidcEndpoints.#assertEnabled();
		return OidcEndpoints.keys.publicJwks();
	}

	// ── Autorización ──────────────────────────────────────────────────────────────

	/**
	 * Devuelve el error **al cliente** por redirect sólo cuando ya se sabe que el destino es legítimo:
	 * redirigir a un `redirect_uri` no verificado convertiría esto en un redirector abierto con un
	 * mensaje de error como carnada.
	 */
	static #redirectError(redirectUri: string, state: string | undefined, error: string, description: string): never {
		const url = new URL(redirectUri);
		url.searchParams.set("error", error);
		url.searchParams.set("error_description", description);
		if (state) url.searchParams.set("state", state);
		throw UncommonResponse.redirect(url.toString(), { status: 302 });
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/oidc/authorize",
		permissions: [],
		options: {
			tag: "SessionManagerService/OIDC",
			summary: "Inicio del flujo de autorización (code + PKCE)",
			description:
				"Si la sesión está abierta emite un código de un solo uso y redirige al `redirect_uri` del cliente; si no, manda al " +
				"login de la plataforma con esta misma URL como retorno. Exige PKCE con `S256`: `plain` viaja igual que el desafío " +
				"y no cierra el hueco que PKCE existe para cerrar.",
			rateLimit: { max: 30, timeWindow: 60_000 },
			schema: { querystring: OS.AuthorizeQuery },
		},
	})
	static async authorize(ctx: EndpointCtx): Promise<never> {
		OidcEndpoints.#assertEnabled();
		const q = ctx.query;
		const client = findClient(OidcEndpoints.config, q.client_id);
		// Cliente o retorno desconocidos: se contesta acá y NO se redirige, así que la persona ve el
		// error en vez del cliente.
		if (!client) throw new HttpError(400, "OIDC_UNKNOWN_CLIENT", `No hay ningún cliente registrado con el id '${q.client_id ?? ""}'.`);
		if (!isAllowedRedirect(client, q.redirect_uri)) {
			throw new HttpError(
				400,
				"OIDC_BAD_REDIRECT",
				`'${q.redirect_uri ?? ""}' no está entre las URIs de retorno declaradas para '${client.name}'. La comparación es exacta, incluido el path.`
			);
		}
		const redirectUri = q.redirect_uri!;

		if (q.response_type !== "code") OidcEndpoints.#redirectError(redirectUri, q.state, "unsupported_response_type", "Sólo se admite `response_type=code`.");
		if (q.code_challenge_method !== "S256") {
			OidcEndpoints.#redirectError(redirectUri, q.state, "invalid_request", "Falta PKCE o no es `S256`, que es el único método admitido.");
		}
		if (!q.code_challenge) OidcEndpoints.#redirectError(redirectUri, q.state, "invalid_request", "Falta `code_challenge`.");

		// Sin sesión, al login, con esta URL como retorno. El `requireAuth` del endpoint manager no
		// sirve acá: contestaría 401 a un navegador que lo que necesita es una pantalla de login.
		if (!ctx.user) {
			const returnUrl = `${OidcEndpoints.config.issuer}/api/oidc/authorize?${new URLSearchParams(
				Object.entries(q).filter((entry): entry is [string, string] => typeof entry[1] === "string")
			).toString()}`;
			const login = new URL(OidcEndpoints.config.loginPath, OidcEndpoints.config.issuer);
			login.searchParams.set("returnUrl", returnUrl);
			throw UncommonResponse.redirect(login.toString(), { status: 302 });
		}

		const code = await OidcEndpoints.codes.issue({
			clientId: client.clientId,
			userId: ctx.user.id,
			redirectUri,
			codeChallenge: q.code_challenge,
			nonce: q.nonce ?? null,
			scope: q.scope ?? "openid",
			authTime: Math.floor(Date.now() / 1000),
		});

		const target = new URL(redirectUri);
		target.searchParams.set("code", code);
		if (q.state) target.searchParams.set("state", q.state);
		throw UncommonResponse.redirect(target.toString(), { status: 302 });
	}

	// ── Canje ─────────────────────────────────────────────────────────────────────

	@RegisterEndpoint({
		method: "POST",
		url: "/api/oidc/token",
		permissions: [],
		options: {
			tag: "SessionManagerService/OIDC",
			summary: "Canje del código por los tokens",
			description:
				"Recibe el formulario estándar (`application/x-www-form-urlencoded`) y devuelve `id_token` y `access_token` firmados " +
				"con RS256. El código es de un solo uso y se consume aunque el canje falle: así los intentos fallidos no sirven para " +
				"ir probando parámetros. Sin autenticación de cliente — son clientes públicos y lo que los protege es PKCE.",
			skipIdempotency: true,
			rateLimit: { max: 30, timeWindow: 60_000 },
			schema: { body: OS.TokenBody, response: { 200: OS.TokenResponse } },
		},
	})
	static async token(ctx: EndpointCtx<Record<string, string>, Record<string, string | undefined>>) {
		OidcEndpoints.#assertEnabled();
		const body = ctx.data ?? {};
		if (body.grant_type !== "authorization_code") {
			throw new HttpError(400, "OIDC_UNSUPPORTED_GRANT", "Sólo se admite `grant_type=authorization_code`.");
		}
		const granted = await OidcEndpoints.codes.consume(body.code);
		if (!granted) throw new HttpError(400, "OIDC_INVALID_CODE", "El código no existe, ya se usó o venció. Volvé a empezar el login.");
		if (granted.clientId !== body.client_id) throw new HttpError(400, "OIDC_INVALID_CODE", "El código no es de ese cliente.");
		// Atado al retorno que lo originó: sin esto, un código robado se puede canjear apuntando a otro destino.
		if (granted.redirectUri !== body.redirect_uri) throw new HttpError(400, "OIDC_INVALID_CODE", "El `redirect_uri` no coincide con el del código.");
		if (!verifyPkce(body.code_verifier, granted.codeChallenge)) {
			throw new HttpError(400, "OIDC_INVALID_VERIFIER", "El `code_verifier` no corresponde al `code_challenge` de este código.");
		}

		const user = await OidcEndpoints.identity?.users.getUser(granted.userId);
		if (!user) throw new HttpError(400, "OIDC_USER_GONE", "La cuenta que autorizó ya no existe.");

		const { issuer, tokenTtlSeconds } = OidcEndpoints.config;
		const claims = OidcEndpoints.#claims(user, granted.scope);
		const base = { iss: issuer, sub: granted.userId, aud: granted.clientId, auth_time: granted.authTime };
		const idToken = await OidcEndpoints.keys.sign({ ...base, ...claims, ...(granted.nonce ? { nonce: granted.nonce } : {}) }, tokenTtlSeconds);
		// El access token también va firmado y con la misma audiencia: el consumidor lo valida contra
		// el JWKS sin tener que preguntarnos nada, que es el punto de todo esto.
		const accessToken = await OidcEndpoints.keys.sign({ ...base, scope: granted.scope }, tokenTtlSeconds);

		return {
			access_token: accessToken,
			id_token: idToken,
			token_type: "Bearer",
			expires_in: tokenTtlSeconds,
			scope: granted.scope,
		};
	}

	/** Los claims del perfil, filtrados por el scope pedido. Sin `profile` ni `email` no se manda nada de eso. */
	static #claims(user: { username: string; email?: string; emailVerified?: boolean }, scope: string): Record<string, unknown> {
		const scopes = new Set(scope.split(/\s+/).filter(Boolean));
		const claims: Record<string, unknown> = {};
		if (scopes.has("profile")) {
			claims.preferred_username = user.username;
			claims.name = user.username;
		}
		if (scopes.has("email") && user.email) {
			claims.email = user.email;
			claims.email_verified = user.emailVerified === true;
		}
		return claims;
	}

	// ── Perfil ────────────────────────────────────────────────────────────────────

	@RegisterEndpoint({
		method: "GET",
		url: "/api/oidc/userinfo",
		permissions: [],
		options: {
			tag: "SessionManagerService/OIDC",
			summary: "Perfil del titular del access token",
			description:
				"Se autentica con el `Authorization: Bearer <access_token>` que devolvió el canje, **no** con la sesión de la " +
				"plataforma: un consumidor OIDC no tiene cookies nuestras. Devuelve los mismos claims que el `id_token`.",
			schema: { response: { 200: OS.UserInfoResponse } },
		},
	})
	static async userinfo(ctx: EndpointCtx) {
		OidcEndpoints.#assertEnabled();
		const header = ctx.headers.authorization ?? "";
		const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
		if (!token) throw new HttpError(401, "OIDC_NO_TOKEN", "Falta el header `Authorization: Bearer <access_token>`.");
		const payload = await OidcEndpoints.keys.verify(token, OidcEndpoints.config.issuer);
		if (!payload?.sub) throw new HttpError(401, "OIDC_BAD_TOKEN", "El access token no es válido o venció.");
		const user = await OidcEndpoints.identity?.users.getUser(String(payload.sub));
		if (!user) throw new HttpError(401, "OIDC_USER_GONE", "La cuenta ya no existe.");
		return { sub: String(payload.sub), ...OidcEndpoints.#claims(user, String(payload.scope ?? "openid")) };
	}
}
