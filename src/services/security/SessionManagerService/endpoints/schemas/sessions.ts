import { Type } from "@sinclair/typebox";

export const SessionsUserIdParams = Type.Object({
	userId: Type.String({ minLength: 1, description: "ID del usuario objetivo" }),
});

/** Sesión activa (metadatos del refresh token; nunca el token en sí). */
const ActiveSessionItem = Type.Object({
	deviceId: Type.String(),
	createdAt: Type.String({ format: "date-time" }),
	expiresAt: Type.String({ format: "date-time" }),
	country: Type.Union([Type.String(), Type.Null()]),
	userAgent: Type.String(),
	ip: Type.String({ description: "IP parcialmente enmascarada" }),
});

export const ListSessionsResponse = Type.Object({
	sessions: Type.Array(ActiveSessionItem),
});

export const RevokeSessionsBody = Type.Object({
	deviceId: Type.Optional(Type.String({ description: "Si se indica, revoca sólo la sesión de ese dispositivo" })),
});

export const RevokeSessionsResponse = Type.Object({
	ok: Type.Boolean(),
	revoked: Type.Number({ description: "Cantidad de sesiones revocadas" }),
});
