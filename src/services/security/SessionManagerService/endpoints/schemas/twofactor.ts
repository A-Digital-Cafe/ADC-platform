import { Type } from "@sinclair/typebox";

/** Schemas TypeBox del segundo factor dentro del login. */

const AuthUser = Type.Object({
	id: Type.String(),
	username: Type.String(),
	email: Type.Optional(Type.String()),
	avatar: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	orgId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	orgSlug: Type.Optional(Type.String()),
});

export const ChallengeStateResponse = Type.Object({
	mode: Type.Union([Type.Literal("verify"), Type.Literal("enroll")]),
	username: Type.String(),
	/** Epoch ms en que vence el desafío. */
	expiresAt: Type.Number(),
	attemptsLeft: Type.Number(),
});

export const VerifyBody = Type.Object({
	code: Type.String({ minLength: 6, maxLength: 32, description: "Código del autenticador o, en modo `verify`, de recuperación" }),
});

export const VerifyResponse = Type.Object({
	success: Type.Boolean(),
	user: Type.Optional(AuthUser),
	/** Destino post-login en los flujos que empezaron con un redirect (OAuth). */
	redirectUrl: Type.Optional(Type.String()),
});

export const EnrollResponse = Type.Object({
	secret: Type.String(),
	otpauthUri: Type.String(),
});

export const EnrollConfirmResponse = Type.Object({
	success: Type.Boolean(),
	user: Type.Optional(AuthUser),
	redirectUrl: Type.Optional(Type.String()),
	/** Se muestran UNA vez: no hay endpoint que los vuelva a servir. */
	recoveryCodes: Type.Optional(Type.Array(Type.String())),
});
