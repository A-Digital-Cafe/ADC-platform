import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { roleHierarchy } from "@common/types/identity/Role.ts";
import type { Role } from "@common/types/identity/Role.ts";
import type { PermissionManager } from "../dao/permissions.js";

/**
 * Guards de jerarquía de roles ("orden de roles"): un actor sólo puede gestionar
 * usuarios/roles cuya jerarquía sea **estrictamente menor** que la suya, y nunca
 * a sí mismo. Se aplican en la capa de endpoints (las superficies internas del
 * kernel no pasan por acá).
 *
 * La jerarquía del actor/target se evalúa en el MISMO contexto de la operación
 * (personal u org), con las mismas reglas que la resolución de permisos.
 */

/** El actor no puede operar sobre sí mismo con permisos de gestión. */
function assertNotSelf(actorId: string | undefined, targetUserId: string): void {
	if (actorId && actorId === targetUserId) {
		throw new IdentityError(403, "CANNOT_MODIFY_SELF", "No podés modificarte a vos mismo con permisos de gestión");
	}
}

/**
 * El actor sólo puede gestionar usuarios de jerarquía estrictamente menor.
 * También bloquea la auto-gestión (target === actor).
 */
export async function assertCanManageUser(
	permissions: PermissionManager,
	actorId: string | undefined,
	targetUserId: string,
	orgId?: string
): Promise<void> {
	if (!actorId) return; // sin sesión resuelta: el permiso formal ya se validó antes
	assertNotSelf(actorId, targetUserId);
	const [actorMax, targetMax] = await Promise.all([
		permissions.getMaxHierarchy(actorId, orgId),
		permissions.getMaxHierarchy(targetUserId, orgId),
	]);
	if (actorMax <= targetMax) {
		throw new IdentityError(403, "HIERARCHY_VIOLATION", "No podés gestionar a un usuario de jerarquía igual o superior a la tuya");
	}
}

/** Sólo se pueden asignar/quitar roles de jerarquía estrictamente menor a la del actor. */
export async function assertCanAssignRoles(
	permissions: PermissionManager,
	actorId: string | undefined,
	roleIds: readonly string[] | undefined,
	orgId?: string
): Promise<void> {
	if (!actorId || !roleIds?.length) return;
	const [actorMax, rolesMax] = await Promise.all([permissions.getMaxHierarchy(actorId, orgId), permissions.getRolesMaxHierarchy(roleIds)]);
	if (rolesMax >= actorMax) {
		throw new IdentityError(403, "HIERARCHY_VIOLATION", "No podés asignar roles de jerarquía igual o superior a la tuya");
	}
}

/** Sólo se pueden editar/eliminar roles de jerarquía estrictamente menor a la del actor. */
export async function assertCanManageRole(
	permissions: PermissionManager,
	actorId: string | undefined,
	role: Pick<Role, "hierarchy">,
	orgId?: string,
	nextHierarchy?: number
): Promise<void> {
	if (!actorId) return;
	const actorMax = await permissions.getMaxHierarchy(actorId, orgId);
	if (roleHierarchy(role) >= actorMax) {
		throw new IdentityError(403, "HIERARCHY_VIOLATION", "No podés gestionar un rol de jerarquía igual o superior a la tuya");
	}
	if (nextHierarchy !== undefined && nextHierarchy >= actorMax) {
		throw new IdentityError(403, "HIERARCHY_VIOLATION", "No podés fijar una jerarquía igual o superior a la tuya");
	}
}
