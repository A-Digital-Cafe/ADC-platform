import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { roleHierarchy } from "@common/types/identity/Role.ts";
import type { Role } from "@common/types/identity/Role.ts";
import type { Permission } from "@common/types/identity/Permission.ts";
import { hasPermission } from "@common/utils/perms.ts";
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

/**
 * **No podés otorgar lo que no tenés.** Cada `{resource, action, scope}` pedido tiene que
 * estar cubierto bit a bit por los permisos efectivos del actor en ESTE contexto (personal
 * u org).
 *
 * La jerarquía numérica sola no alcanzaba: un manager (jerarquía 500, sin ser admin) podía
 * crear un rol de jerarquía 499 con `{resource:"*", action:31, scope:65535}` —el guard de
 * jerarquía pasa, y `assertNoGlobalOnlyPerms` retorna de inmediato cuando el rol es global—,
 * asignárselo a un usuario títere y loguearse como admin de plataforma. La variante corta
 * ni siquiera necesita crear el rol: `PUT /users/:id` con `permissions` sobre cualquier
 * usuario de jerarquía menor.
 *
 * `hasPermission` ya trata `resource: "*"` correctamente en las dos direcciones: un pedido
 * de `"*"` sólo lo cubre un permiso `"*"` del actor, y un permiso `"*"` del actor cubre
 * cualquier recurso concreto.
 */
export async function assertCanGrantPermissions(
	permissions: PermissionManager,
	actorId: string | undefined,
	requested: readonly Permission[] | undefined,
	orgId?: string,
	current?: readonly Permission[] | null
): Promise<void> {
	if (!actorId || !requested?.length) return; // sin sesión resuelta: superficie interna del kernel

	// Entradas idénticas a las que el recurso YA tiene no son un otorgamiento: se dejan pasar
	// para que un `PUT` que sólo cambia el nombre no rebote con 403 sobre permisos preexistentes.
	// No abre nada: reenviar lo que ya estaba guardado no agrega privilegio.
	const permKey = (p: Permission) => JSON.stringify([p.resource, p.action, p.scope]);
	const unchanged = new Set((current ?? []).map(permKey));

	const actorPerms = await permissions.resolvePermissions(actorId, orgId);
	for (const perm of requested) {
		if (unchanged.has(permKey(perm))) continue;
		if (!hasPermission(actorPerms, perm.resource, perm.action, perm.scope)) {
			throw new IdentityError(
				403,
				"PERMISSION_ESCALATION",
				`No podés otorgar permisos que no tenés: ${perm.resource} (action=${perm.action}, scope=${perm.scope})`
			);
		}
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
