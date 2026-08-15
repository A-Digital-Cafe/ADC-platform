import { Type } from "@sinclair/typebox";

/**
 * Schemas TypeBox del proveedor OIDC.
 *
 * Los nombres de campo son `snake_case` porque los fija la especificación de OpenID Connect, no una
 * preferencia del repo: un consumidor los busca exactamente así. Es el único lugar del código donde
 * la convención de nombres viene de afuera.
 */

const Str = Type.String();

export const DiscoveryResponse = Type.Object({
	issuer: Str,
	authorization_endpoint: Str,
	token_endpoint: Str,
	userinfo_endpoint: Str,
	jwks_uri: Str,
	response_types_supported: Type.Array(Str),
	grant_types_supported: Type.Array(Str),
	subject_types_supported: Type.Array(Str),
	id_token_signing_alg_values_supported: Type.Array(Str),
	scopes_supported: Type.Array(Str),
	token_endpoint_auth_methods_supported: Type.Array(Str),
	code_challenge_methods_supported: Type.Array(Str),
	claims_supported: Type.Array(Str),
});

export const JwksResponse = Type.Object({
	keys: Type.Array(
		Type.Object({
			kty: Type.Optional(Str),
			n: Type.Optional(Str),
			e: Type.Optional(Str),
			kid: Type.Optional(Str),
			alg: Type.Optional(Str),
			use: Type.Optional(Str),
		})
	),
});

export const AuthorizeQuery = Type.Object({
	client_id: Type.Optional(Str),
	redirect_uri: Type.Optional(Str),
	response_type: Type.Optional(Str),
	scope: Type.Optional(Str),
	state: Type.Optional(Str),
	nonce: Type.Optional(Str),
	code_challenge: Type.Optional(Str),
	code_challenge_method: Type.Optional(Str),
});

/**
 * El cuerpo llega como `application/x-www-form-urlencoded`, que es lo que manda la spec y lo que
 * mandan todos los clientes. Se declara sin `additionalProperties: false` a propósito: hay clientes
 * que agregan campos propios y rechazar el canje por eso sería romper por purismo.
 */
export const TokenBody = Type.Object({
	grant_type: Type.Optional(Str),
	code: Type.Optional(Str),
	redirect_uri: Type.Optional(Str),
	client_id: Type.Optional(Str),
	code_verifier: Type.Optional(Str),
});

export const TokenResponse = Type.Object({
	access_token: Str,
	id_token: Str,
	token_type: Str,
	expires_in: Type.Number(),
	scope: Str,
});

export const UserInfoResponse = Type.Object({
	sub: Str,
	preferred_username: Type.Optional(Str),
	name: Type.Optional(Str),
	email: Type.Optional(Str),
	email_verified: Type.Optional(Type.Boolean()),
});
