import type { Permission, ResolvedPermission } from "@common/types/identity/Permission.ts";
import type { Role } from "@common/types/identity/Role.ts";
import { SystemRole } from "../defaults/systemRoles.js";
import { isGlobalOnlyResource } from "@common/types/resources.ts";

/**
 * Helpers puros de la resolución jerárquica de permisos (sin modelos ni cache):
 * predicados de contexto, filtro globalOnly y acumulación por nivel.
 * La orquestación (queries + orden de niveles) vive en `PermissionManager`.
 */

/** Permisos finales por recurso mientras se aplica la jerarquía. */
export type FinalPerms = Map<string, { action: number; scope: number; source: ResolvedPermission["source"] }>;

/**
 * Filtra permisos de recursos `globalOnly` (security, modules): sólo un **rol
 * global** (orgId nulo) puede portarlos. Se descartan de permisos directos de
 * usuario, grupos, orgs y roles de organización.
 */
export function filterGlobalOnly(permissions: Permission[], fromGlobalRole: boolean): Permission[] {
	if (fromGlobalRole) return permissions;
	return permissions.filter((p) => !isGlobalOnlyResource(p.resource));
}

/** Doc de mongoose o objeto plano; normaliza a objeto plano (o null). */
export function asPlain<T>(doc: unknown): T | null {
	return ((doc as { toObject?: () => T } | null)?.toObject?.() as T | undefined) ?? (doc as T | null) ?? null;
}

/**
 * En contexto de organización: sólo grupos de esa org (no bleed de grupos
 * personales). En contexto personal: sólo grupos sin org.
 */
export function isGroupInContext(group: { orgId?: string | null } | null, orgId?: string): boolean {
	if (!group) return false;
	if (orgId) return group.orgId === orgId;
	return !group.orgId;
}

/**
 * Los roles directos del usuario (sin orgId) sólo aplican en contexto personal.
 * Al cambiar a una org, se ignoran para que los permisos estén acotados a esa org.
 */
export function isDirectRoleInContext(role: { orgId?: string | null } | null, orgId?: string): boolean {
	if (!role) return false;
	if (orgId) return false;
	return !role.orgId;
}

/** Rol de membresía: aplica sólo dentro de su organización. */
export function isMembershipRoleInContext(role: { orgId?: string | null } | null, orgId?: string): boolean {
	if (!role || !orgId) return false;
	return role.orgId === orgId;
}

/**
 * SYSTEM y ADMIN globales aplican cross-org (gestión de cualquier organización);
 * otros roles globales quedan confinados al contexto personal.
 */
export function isCrossOrgGlobalRole(role: Pick<Role, "name" | "orgId"> | null): boolean {
	return !!role && !role.orgId && (role.name === SystemRole.SYSTEM || role.name === SystemRole.ADMIN);
}

/**
 * Acumula los permisos de un nivel de jerarquía sobre `finalPerms`:
 * dentro del nivel se suman (OR de bitfields) y el nivel entero hace
 * override del anterior para cada recurso tocado.
 */
export function applyLevel(finalPerms: FinalPerms, permissions: Permission[], source: ResolvedPermission["source"]): void {
	if (!permissions.length) return;
	const levelPerms = new Map<string, { action: number; scope: number }>();
	for (const perm of permissions) {
		const existing = levelPerms.get(perm.resource);
		if (existing) {
			existing.action |= perm.action;
			existing.scope |= perm.scope;
		} else {
			levelPerms.set(perm.resource, { action: perm.action, scope: perm.scope });
		}
	}
	for (const [resource, perm] of levelPerms) {
		finalPerms.set(resource, { action: perm.action, scope: perm.scope, source });
	}
}

/** Convierte el mapa acumulado en la lista final (descarta action/scope vacíos). */
export function toResolvedPermissions(finalPerms: FinalPerms): ResolvedPermission[] {
	const result: ResolvedPermission[] = [];
	for (const [resource, perm] of finalPerms) {
		if (perm.action > 0 && perm.scope > 0) {
			result.push({ resource, action: perm.action, scope: perm.scope, granted: true, source: perm.source });
		}
	}
	return result;
}
