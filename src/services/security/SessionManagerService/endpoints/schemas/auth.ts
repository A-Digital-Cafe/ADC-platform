import { Type } from "@sinclair/typebox";

/**
 * Schemas TypeBox para los endpoints de autenticación nativa de SessionManagerService.
 * Alimentan la validación de entrada (runtime) y el doc OpenAPI en `/api/docs`.
 */

// ── Body ─────────────────────────────────────────────────────────────────

export const LoginBody = Type.Object({
	username: Type.String({ minLength: 1 }),
	password: Type.String({ minLength: 1 }),
	orgId: Type.Optional(
		Type.Union([Type.String(), Type.Null()], { description: "null = acceso personal; omitir = elegir organización después" })
	),
});

export const RegisterBody = Type.Object({
	username: Type.String({ minLength: 3, maxLength: 32 }),
	email: Type.String({ minLength: 5, maxLength: 254 }),
	password: Type.String({ minLength: 8, maxLength: 256 }),
});

export const SwitchOrgBody = Type.Object({
	orgId: Type.Optional(
		Type.Union([Type.String(), Type.Null()], { description: "Organización destino; null/omitir = acceso personal" })
	),
});

// ── Responses ──────────────────────────────────────────────────────────────

const AuthUser = Type.Object({
	id: Type.String(),
	username: Type.String(),
	email: Type.Optional(Type.String()),
	avatar: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	orgId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	orgSlug: Type.Optional(Type.String()),
});

const OrgOption = Type.Object({
	orgId: Type.Union([Type.String(), Type.Null()]),
	slug: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
});

/** Respuesta de login: éxito directo o solicitud de selección de organización. */
export const LoginResponse = Type.Object({
	success: Type.Boolean(),
	user: Type.Optional(AuthUser),
	requiresOrgSelection: Type.Optional(Type.Boolean()),
	userId: Type.Optional(Type.String()),
	username: Type.Optional(Type.String()),
	orgOptions: Type.Optional(Type.Array(OrgOption)),
});

export const RegisterResponse = Type.Object({
	success: Type.Boolean(),
	user: AuthUser,
});

const SessionUser = Type.Object({
	id: Type.String(),
	username: Type.String(),
	email: Type.Optional(Type.String()),
	avatar: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	provider: Type.Optional(Type.String()),
	orgId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	orgSlug: Type.Optional(Type.String()),
	perms: Type.Unknown(),
	isAdmin: Type.Boolean(),
	isOrgAdmin: Type.Boolean(),
	groupIds: Type.Array(Type.String()),
});

export const SessionResponse = Type.Object({
	authenticated: Type.Boolean(),
	user: SessionUser,
	expiresAt: Type.Union([Type.String({ format: "date-time" }), Type.Number()]),
});

export const UserOrgsResponse = Type.Object({
	orgs: Type.Array(OrgOption),
	currentOrgId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const SwitchOrgResponse = Type.Object({
	success: Type.Boolean(),
	user: AuthUser,
});

export const RefreshResponse = Type.Object({ success: Type.Boolean() });

export const LogoutResponse = Type.Object({
	success: Type.Boolean(),
	message: Type.Optional(Type.String()),
});
