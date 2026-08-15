import { Type } from "@sinclair/typebox";
import { PermissionInput } from "./common.js";
import { RoleResponse } from "./roles.js";

// ── Entidad ────────────────────────────────────────────────────────────────

const OrgMembershipSchema = Type.Object({
	orgId: Type.String(),
	roleIds: Type.Array(Type.String()),
	joinedAt: Type.String({ format: "date-time" }),
});

const LinkedAccountSchema = Type.Object({
	provider: Type.String(),
	providerId: Type.String(),
	providerUsername: Type.Optional(Type.String()),
	providerAvatar: Type.Optional(Type.String()),
	status: Type.Union([Type.Literal("linked"), Type.Literal("unlinked")]),
	linkedAt: Type.String({ format: "date-time" }),
	unlinkedAt: Type.Optional(Type.String({ format: "date-time" })),
});

/** Usuario expuesto al cliente (sin `passwordHash`). */
export const UserResponse = Type.Object({
	id: Type.String(),
	username: Type.String(),
	email: Type.Optional(Type.String()),
	avatar: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	roleIds: Type.Array(Type.String()),
	groupIds: Type.Array(Type.String()),
	permissions: Type.Optional(Type.Array(PermissionInput)),
	orgMemberships: Type.Optional(Type.Array(OrgMembershipSchema)),
	linkedAccounts: Type.Optional(Type.Array(LinkedAccountSchema)),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	isActive: Type.Boolean(),
	createdAt: Type.String({ format: "date-time" }),
	updatedAt: Type.String({ format: "date-time" }),
	lastLogin: Type.Optional(Type.String({ format: "date-time" })),
});

/** Respuesta de `GET /api/identity/users`: página de usuarios + roles referenciados + total. */
export const UsersListResponse = Type.Object({
	users: Type.Array(UserResponse),
	roles: Type.Array(RoleResponse),
	total: Type.Integer({ minimum: 0, description: "Total de usuarios que matchean el filtro (para paginar)" }),
});

/** Array de usuarios (búsqueda, miembros, etc.). */
export const UsersArrayResponse = Type.Array(UserResponse);

export const UserIdParams = Type.Object({
	userId: Type.String({ minLength: 1, description: "ID del usuario" }),
});

export const UsernameParams = Type.Object({
	username: Type.String({ minLength: 1, description: "Nombre de usuario" }),
});

export const ListUsersQuery = Type.Object({
	orgId: Type.Optional(Type.String({ description: "Filtra por organización (solo admin global)" })),
	q: Type.Optional(Type.String({ description: "Filtro por username/email (mín. 2 caracteres; busca sobre toda la colección)" })),
	limit: Type.Optional(Type.String({ pattern: String.raw`^\d+$`, description: "Tamaño de página (se clampa a 500)" })),
	offset: Type.Optional(Type.String({ pattern: String.raw`^\d+$`, description: "Desplazamiento (para paginar)" })),
});

export const SearchUsersQuery = Type.Object({
	q: Type.Optional(Type.String({ description: "Texto de búsqueda (mín. 2 caracteres)" })),
	orgId: Type.Optional(Type.String({ description: "Filtra por organización (solo admin global)" })),
});

export const AvatarsQuery = Type.Object({
	ids: Type.Optional(Type.String({ description: "IDs de usuario separados por coma" })),
});

/** Body del cambio de contraseña propio. `currentPassword` es opcional SÓLO para cuentas creadas por OAuth. */
export const ChangePasswordBody = Type.Object({
	currentPassword: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: "Contraseña actual (obligatoria salvo cuentas creadas por OAuth)" })),
	newPassword: Type.String({ minLength: 8, maxLength: 256, description: "Nueva contraseña (mín. 8)" }),
});

/** Body del pedido de cambio de email propio. `currentPassword` es opcional SÓLO para cuentas creadas por OAuth. */
export const ChangeEmailBody = Type.Object({
	newEmail: Type.String({ minLength: 5, maxLength: 254, description: "Nueva dirección de email (recibe el enlace de confirmación)" }),
	currentPassword: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: "Contraseña actual (obligatoria salvo cuentas creadas por OAuth)" })),
});

export const ChangeEmailResponse = Type.Object({
	success: Type.Boolean(),
	expiresInMinutes: Type.Number({ description: "Vigencia del enlace de confirmación enviado a la casilla nueva" }),
});

/** Body del canje público del token de confirmación de cambio de email. */
export const EmailChangeTokenBody = Type.Object({
	token: Type.String({ minLength: 32, maxLength: 512, description: "Token de confirmación recibido en la casilla nueva" }),
});

/** Body del cambio de username propio (mismas reglas del alta + cooldown de 30 días). */
export const ChangeUsernameBody = Type.Object({
	newUsername: Type.String({ minLength: 3, maxLength: 30, description: "Nuevo nombre de usuario (3-30 caracteres)" }),
	currentPassword: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: "Contraseña actual (obligatoria salvo cuentas creadas por OAuth)" })),
});

export const ChangeUsernameResponse = Type.Object({
	success: Type.Boolean(),
	username: Type.String({ description: "Username vigente tras el cambio" }),
});

export const CreateUserBody = Type.Object({
	username: Type.String({ minLength: 3, maxLength: 32 }),
	password: Type.String({ minLength: 8, maxLength: 256 }),
	roleIds: Type.Optional(Type.Array(Type.String())),
	orgId: Type.Optional(Type.String({ description: "Solo admin global" })),
});

export const UpdateUserBody = Type.Partial(
	Type.Object({
		username: Type.String({ minLength: 3, maxLength: 32 }),
		email: Type.String({ minLength: 5, maxLength: 254 }),
		isActive: Type.Boolean(),
		roleIds: Type.Array(Type.String()),
		groupIds: Type.Array(Type.String()),
		permissions: Type.Array(PermissionInput),
	})
);

/** Preferencias del usuario: objeto plano arbitrario (merge superficial). */
export const PreferencesBody = Type.Record(Type.String(), Type.Unknown(), {
	description: "Objeto plano de preferencias (se hace merge superficial)",
});

export const DeleteSelfBody = Type.Object({
	reason: Type.Optional(Type.String({ maxLength: 1000, description: "Motivo de la baja (opcional, texto libre)" })),
});

/** Query del DELETE admin: filtro org + variante inmediata de la baja. */
export const DeleteUserQuery = Type.Object({
	orgId: Type.Optional(Type.String({ description: "Filtra por organización (solo admin global)" })),
	immediate: Type.Optional(
		Type.Union([Type.Literal("true"), Type.Literal("false")], {
			description: "true = ejecuta la cascada de purga ya mismo en vez de esperar los 30 días de retención",
		})
	),
});

/** Body del canje público del token de arrepentimiento (cancela una baja voluntaria). */
export const CancelDeletionTokenBody = Type.Object({
	token: Type.String({ minLength: 32, maxLength: 512, description: "Token de cancelación recibido por email" }),
});

// ── Responses ──────────────────────────────────────────────────────────────

export const PreferencesResponse = Type.Object({
	preferences: Type.Record(Type.String(), Type.Unknown()),
});

export const PublicAvatarsResponse = Type.Object({
	profiles: Type.Record(
		Type.String(),
		Type.Object({
			username: Type.Optional(Type.String()),
			avatar: Type.Union([Type.String(), Type.Null()]),
		})
	),
});

export const DeleteSelfResponse = Type.Object({
	success: Type.Boolean(),
	scheduledDeletionInDays: Type.Number(),
	/** `false` si el aviso con el enlace de arrepentimiento no se pudo entregar. La baja se registró igual. */
	noticeDelivered: Type.Boolean(),
	/**
	 * Enlace de arrepentimiento, presente SÓLO cuando el aviso no pudo entregarse: el
	 * cliente debe mostrarlo para que la persona lo guarde. Volver a iniciar sesión
	 * durante los 30 días también cancela la baja.
	 */
	cancelUrl: Type.Union([Type.String(), Type.Null()]),
});

/** Body para otorgar un upgrade temporal de tier (recompensa de bug bounty). */
export const TierGrantBody = Type.Object({
	tier: Type.Union([Type.Literal("pro"), Type.Literal("plus")], { description: "Tier a otorgar mientras dure el grant" }),
	days: Type.Integer({ minimum: 1, maximum: 366, description: "Duración del upgrade en días" }),
	reason: Type.Optional(Type.String({ maxLength: 200, description: "Trazabilidad, ej. bug-bounty:STATUS-123" })),
});

export const TierGrantResponse = Type.Object({
	tier: Type.String(),
	previousTier: Type.String(),
	grantedAt: Type.String(),
	expiresAt: Type.String(),
	reason: Type.Optional(Type.String()),
});
