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
});

export const storedRefreshTokenCheck = compileSchema(StoredRefreshTokenSchema);

export type StoredRefreshToken = Static<typeof StoredRefreshTokenSchema>;
