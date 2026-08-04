import { Type, type Static } from "@sinclair/typebox";
import { compileSchema } from "@common/utils/json-schema.ts";

/**
 * Refresh token tal como se persiste en Redis. El schema es la fuente única del
 * tipo y del validador runtime con el que se comprueba lo leído de Redis antes
 * de tratarlo como un token válido.
 */
const StoredRefreshTokenSchema = Type.Object({
	token: Type.String(),
	userId: Type.String(),
	deviceId: Type.String(),
	createdAt: Type.Number(),
	expiresAt: Type.Number(),
	ipAddress: Type.String(),
	country: Type.Union([Type.String(), Type.Null()]),
	userAgent: Type.String(),
	revoked: Type.Boolean(),
	/**
	 * **Id** (no el valor) del token que reemplazó a éste en una rotación. Junto con
	 * `replacedAt` habilita la ventana de gracia: una pestaña que llega tarde con el token
	 * viejo recibe el par vigente en vez de un 401 (ver `RefreshTokenRepository.resolveCurrent`).
	 */
	replacedBy: Type.Optional(Type.String()),
	replacedAt: Type.Optional(Type.Number()),
});

export const storedRefreshTokenCheck = compileSchema(StoredRefreshTokenSchema);

export type StoredRefreshToken = Static<typeof StoredRefreshTokenSchema>;
