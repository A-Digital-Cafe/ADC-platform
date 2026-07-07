import { Type } from "@sinclair/typebox";
import { PermissionInput } from "./common.js";

// ── Entidad ────────────────────────────────────────────────────────────────

/** Rol del sistema. */
export const RoleResponse = Type.Object({
	id: Type.String(),
	name: Type.String(),
	description: Type.String(),
	permissions: Type.Array(PermissionInput),
	isCustom: Type.Boolean(),
	orgId: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "Organización (null = global)" })),
	hierarchy: Type.Optional(Type.Number({ description: "Orden del rol (mayor = más autoridad; ausente = 100)" })),
	createdAt: Type.String({ format: "date-time" }),
});

export const RolesListResponse = Type.Array(RoleResponse);

// ── Params ───────────────────────────────────────────────────────────────

export const RoleIdParams = Type.Object({
	roleId: Type.String({ minLength: 1, description: "ID del rol" }),
});

// ── Body ─────────────────────────────────────────────────────────────────

/** Jerarquía asignable a roles custom: siempre por debajo de Admin (900). */
const HierarchyInput = Type.Number({ minimum: 0, maximum: 899, description: "Orden del rol; debe ser menor a la jerarquía del actor" });

export const CreateRoleBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 64 }),
	description: Type.Optional(Type.String({ maxLength: 256 })),
	permissions: Type.Optional(Type.Array(PermissionInput)),
	orgId: Type.Optional(Type.String({ description: "Solo admin global" })),
	hierarchy: Type.Optional(HierarchyInput),
});

export const UpdateRoleBody = Type.Partial(
	Type.Object({
		name: Type.String({ minLength: 1, maxLength: 64 }),
		description: Type.String({ maxLength: 256 }),
		permissions: Type.Array(PermissionInput),
		hierarchy: HierarchyInput,
	})
);
