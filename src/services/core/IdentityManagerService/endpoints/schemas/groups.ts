import { Type } from "@sinclair/typebox";
import { PermissionInput } from "./common.js";

// ── Entidad ────────────────────────────────────────────────────────────────

export const GroupResponse = Type.Object({
	id: Type.String(),
	name: Type.String(),
	description: Type.Optional(Type.String()),
	orgId: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "Organización (null = global)" })),
	roleIds: Type.Array(Type.String()),
	permissions: Type.Optional(Type.Array(PermissionInput)),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	createdAt: Type.String({ format: "date-time" }),
	updatedAt: Type.String({ format: "date-time" }),
});

export const GroupsListResponse = Type.Array(GroupResponse);

// ── Params ───────────────────────────────────────────────────────────────

export const GroupIdParams = Type.Object({
	groupId: Type.String({ minLength: 1, description: "ID del grupo" }),
});

export const GroupUserParams = Type.Object({
	groupId: Type.String({ minLength: 1, description: "ID del grupo" }),
	userId: Type.String({ minLength: 1, description: "ID del usuario" }),
});

// ── Query ────────────────────────────────────────────────────────────────

export const SearchGroupsQuery = Type.Object({
	q: Type.Optional(Type.String({ description: "Texto de búsqueda (mín. 2 caracteres)" })),
	orgId: Type.Optional(Type.String({ description: "Filtra por organización (solo admin global)" })),
});

// ── Body ─────────────────────────────────────────────────────────────────

export const CreateGroupBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 64 }),
	description: Type.Optional(Type.String({ maxLength: 256 })),
	roleIds: Type.Optional(Type.Array(Type.String())),
	orgId: Type.Optional(Type.String({ description: "Solo admin global" })),
});

export const UpdateGroupBody = Type.Partial(
	Type.Object({
		name: Type.String({ minLength: 1, maxLength: 64 }),
		description: Type.String({ maxLength: 256 }),
		roleIds: Type.Array(Type.String()),
		permissions: Type.Array(PermissionInput),
	})
);
