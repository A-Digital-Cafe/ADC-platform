import type { Model } from "mongoose";
import { Permission, ResolvedPermission } from "@common/types/identity/Permission.ts";
import type { User, OrgMembership } from "@common/types/identity/User.ts";
import { roleHierarchy, type Role } from "@common/types/identity/Role.ts";
import type { Group } from "@common/types/identity/Group.ts";
import type { Organization } from "@common/types/identity/Organization.ts";
import LRUCache from "../../../../utils/performance/LRUCache.ts";
import { SystemRole } from "../defaults/systemRoles.js";
import { hasPermission } from "@common/utils/perms.ts";
import { isGlobalOnlyResource } from "@common/types/resources.ts";

/**
 * Filtra permisos de recursos `globalOnly` (security, modules): sólo un **rol
 * global** (orgId nulo) puede portarlos. Se descartan de permisos directos de
 * usuario, grupos, orgs y roles de organización.
 */
function filterGlobalOnly(permissions: Permission[], fromGlobalRole: boolean): Permission[] {
	if (fromGlobalRole) return permissions;
	return permissions.filter((p) => !isGlobalOnlyResource(p.resource));
}

interface PermissionCacheEntry {
	permissions: ResolvedPermission[];
	timestamp: number;
}

/**
 * Permisos acumulados por recurso en un nivel de jerarquía
 */
interface LevelPermission {
	action: number;
	scope: number;
}

/**
 * PermissionManager - Gestión de permisos con cache LRU y bitfields
 *
 * Características:
 * - NO persiste permisos (viven en users, groups, roles, orgs)
 * - Cache LRU para permisos resueltos
 * - Jerarquía de override: user → userRoles → groups → groupRoles → org
 *   (niveles superiores reemplazan a inferiores por recurso)
 * - Dentro del mismo nivel: permisos se suman (OR de bitfields)
 * - Actions y Scopes como bitfields numéricos
 *
 * Usa modelos Mongoose directamente para evitar recursión de auth
 * (los DAOs ahora siempre requieren token, pero PermissionManager
 * necesita leer datos internamente sin token para resolver permisos)
 */
export class PermissionManager {
	readonly #cache: LRUCache<string, PermissionCacheEntry>;
	readonly #cacheTTL: number;

	constructor(
		private readonly userModel: Model<User>,
		private readonly roleModel: Model<Role>,
		private readonly groupModel: Model<Group>,
		private readonly orgModel?: Model<Organization>,
		cacheSize: number = 1000,
		cacheTTL: number = 60000 // 1 minuto por defecto
	) {
		this.#cache = new LRUCache(cacheSize);
		this.#cacheTTL = cacheTTL;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Chequeo de permisos
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Verifica si un usuario tiene un permiso específico
	 * @param userId - ID del usuario
	 * @param action - Bitfield de acciones requeridas (Action.READ | Action.WRITE)
	 * @param scope - Bitfield de scope requerido (Scope.USERS | Scope.GROUPS)
	 * @param orgId - ID de organización (opcional)
	 * @param resource - Nombre del recurso a verificar (default: "identity"). Wildcard "*" siempre coincide.
	 */
	async hasPermission(
		userId: string,
		action: number,
		scope: number,
		orgId?: string,
		resource?: string,
		opts?: { ownerId?: string }
	): Promise<boolean> {
		const resolved = await this.resolvePermissions(userId, orgId);
		return hasPermission(resolved, resource ?? "identity", action, scope, { selfId: userId, ownerId: opts?.ownerId });
	}

	/**
	 * Resuelve TODOS los permisos de un usuario (con cache)
	 */
	async resolvePermissions(userId: string, orgId?: string): Promise<ResolvedPermission[]> {
		const cacheKey = `${userId}:${orgId || "global"}`;

		// Check cache
		const cached = this.#cache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < this.#cacheTTL) {
			return cached.permissions;
		}

		// Resolver permisos en orden de jerarquía
		const permissions = await this.#resolveHierarchy(userId, orgId);

		// Cache result
		this.#cache.set(cacheKey, { permissions, timestamp: Date.now() });

		return permissions;
	}

	/**
	 * Resuelve la jerarquía completa de permisos
	 * Orden de prioridad (mayor a menor): user → userRoles → groups → groupRoles → org
	 *
	 * - Niveles superiores hacen override de inferiores (por recurso)
	 * - Dentro del mismo nivel, los permisos se suman (OR de bitfields)
	 */
	async #resolveHierarchy(userId: string, orgId?: string): Promise<ResolvedPermission[]> {
		// Permisos finales por recurso: { resource -> { action, scope, source } }
		const finalPerms = new Map<string, { action: number; scope: number; source: ResolvedPermission["source"] }>();

		const isGroupInContext = (group: { orgId?: string | null } | null): boolean => {
			if (!group) return false;
			// En contexto de organización: sólo grupos de esa org (no bleed de grupos personales)
			if (orgId) return group.orgId === orgId;
			// En contexto personal: sólo grupos sin org
			return !group.orgId;
		};

		const isDirectRoleInContext = (role: { orgId?: string | null } | null): boolean => {
			if (!role) return false;
			// Los roles directos del usuario (sin orgId) sólo aplican en contexto personal.
			// Al cambiar a una org, se ignoran para que los permisos estén acotados a esa org.
			if (orgId) return false;
			return !role.orgId;
		};

		const isMembershipRoleInContext = (role: { orgId?: string | null } | null): boolean => {
			if (!role || !orgId) return false;
			return role.orgId === orgId;
		};

		// Helper: acumula permisos de un nivel (OR dentro del nivel, override entre niveles)
		const applyLevel = (permissions: Permission[], source: ResolvedPermission["source"]) => {
			// Primero acumulamos todos los permisos de este nivel por recurso
			const levelPerms = new Map<string, LevelPermission>();
			for (const perm of permissions) {
				const existing = levelPerms.get(perm.resource);
				if (existing) {
					// Mismo nivel, mismo recurso: sumar (OR)
					existing.action |= perm.action;
					existing.scope |= perm.scope;
				} else {
					levelPerms.set(perm.resource, { action: perm.action, scope: perm.scope });
				}
			}

			// Luego aplicamos override: este nivel reemplaza al anterior para cada recurso
			for (const [resource, perm] of levelPerms) {
				finalPerms.set(resource, { action: perm.action, scope: perm.scope, source });
			}
		};

		// 5. Org permissions (base, menor prioridad)
		if (orgId && this.orgModel) {
			const orgDoc = await this.orgModel.findOne({ $or: [{ orgId }, { slug: orgId.toLowerCase() }] });
			const org = (orgDoc?.toObject?.() as Organization | undefined) ?? orgDoc ?? null;
			if (org?.permissions?.length) {
				applyLevel(filterGlobalOnly(org.permissions, false), "org");
			}
		}

		// Obtener usuario
		const userDoc = await this.userModel.findOne({ id: userId });
		const user = (userDoc?.toObject?.() as User | undefined) ?? userDoc ?? null;
		if (!user) return [];

		// Pre-cargar grupos para evitar queries duplicadas
		const groupDocs = await this.groupModel.find({ id: { $in: user.groupIds || [] } });
		const groups = groupDocs.map((d) => (d?.toObject?.() as Group) || d || null);
		const validGroups = groups.filter((g): g is NonNullable<typeof g> => isGroupInContext(g));

		// Recopilar todos los roleIds de grupos para una sola query
		const groupRoleIds = validGroups.flatMap((g) => g.roleIds || []);
		const groupRoleDocs = groupRoleIds.length ? await this.roleModel.find({ id: { $in: groupRoleIds } }) : [];
		const groupRolesMap = new Map(groupRoleDocs.map((d) => [((d.toObject?.() as Role) || d).id, (d.toObject?.() as Role) || d]));

		// 4. Group roles (acumulamos todos los roles de todos los grupos)
		// Sólo un rol GLOBAL adjuntado a un grupo conserva permisos globalOnly.
		const groupRolePerms: Permission[] = [];
		for (const group of validGroups) {
			for (const roleId of group.roleIds || []) {
				const role = groupRolesMap.get(roleId);
				if (role) {
					groupRolePerms.push(...filterGlobalOnly(role.permissions, !role.orgId));
				}
			}
		}
		if (groupRolePerms.length) {
			applyLevel(groupRolePerms, "groupRole");
		}

		// 3. Group direct permissions (acumulamos de todos los grupos)
		const groupPerms: Permission[] = [];
		for (const group of validGroups) {
			if (group.permissions?.length) {
				groupPerms.push(...filterGlobalOnly(group.permissions, false));
			}
		}
		if (groupPerms.length) {
			applyLevel(groupPerms, "group");
		}

		// 2. User roles (directos + orgMembership)
		const userRolePerms: Permission[] = [];

		// Pre-cargar todos los roles del usuario (directos + orgMembership) en una query
		const allUserRoleIds = [...(user.roleIds || [])];
		const orgMembership = orgId ? user.orgMemberships?.find((m: OrgMembership) => m.orgId === orgId) : null;
		if (orgMembership) {
			allUserRoleIds.push(...(orgMembership.roleIds || []));
		}
		const userRoleDocs = allUserRoleIds.length ? await this.roleModel.find({ id: { $in: allUserRoleIds } }) : [];
		const userRolesMap = new Map(userRoleDocs.map((d) => [((d.toObject?.() as Role) || d).id, (d.toObject?.() as Role) || d]));

		// 2b. Roles de orgMembership (si hay orgId)
		// Los roles de org NUNCA portan permisos globalOnly; SYSTEM/ADMIN son globales.
		if (orgId && orgMembership) {
			for (const roleId of orgMembership.roleIds || []) {
				const role = userRolesMap.get(roleId);
				if (!role) continue;
				if (isMembershipRoleInContext(role) || (!role.orgId && (role.name === SystemRole.SYSTEM || role.name === SystemRole.ADMIN)))
					userRolePerms.push(...filterGlobalOnly(role.permissions, !role.orgId));
			}
		}

		// 2a. User roles directos
		for (const roleId of user.roleIds || []) {
			const role = userRolesMap.get(roleId);
			if (role && isDirectRoleInContext(role)) {
				userRolePerms.push(...filterGlobalOnly(role.permissions, !role.orgId));
			}
			// En contexto de org: SYSTEM y ADMIN (roles globales) siempre aplican,
			// para permitir gestión cross-org. Otros roles globales quedan confinados
			// al contexto personal.
			if (orgId && role && !role.orgId && (role.name === SystemRole.SYSTEM || role.name === SystemRole.ADMIN)) {
				userRolePerms.push(...role.permissions);
			}
		}
		if (userRolePerms.length) {
			applyLevel(userRolePerms, "userRole");
		}

		// 1. User direct permissions (mayor prioridad)
		// Sólo aplican en contexto personal — dentro de una org no deben filtrarse.
		// Los permisos directos de usuario tampoco portan recursos globalOnly:
		// éstos se delegan únicamente por rol global (auditables en la UI de roles).
		if (!orgId && user.permissions?.length) {
			applyLevel(filterGlobalOnly(user.permissions, false), "user");
		}

		// Convertir a ResolvedPermissions
		const result: ResolvedPermission[] = [];
		for (const [resource, perm] of finalPerms) {
			if (perm.action > 0 && perm.scope > 0) {
				result.push({
					resource,
					action: perm.action,
					scope: perm.scope,
					granted: true,
					source: perm.source,
				});
			}
		}

		return result;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Jerarquía de roles
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Jerarquía máxima de un usuario en un contexto (mayor = más autoridad; 0 = sin roles).
	 * Considera los mismos roles que la resolución de permisos: directos (contexto
	 * personal), de membresía (contexto org), de grupos del contexto, y SYSTEM/ADMIN
	 * globales que aplican cross-org.
	 */
	async getMaxHierarchy(userId: string, orgId?: string): Promise<number> {
		const userDoc = await this.userModel.findOne({ id: userId });
		const user = (userDoc?.toObject?.() as User | undefined) ?? userDoc ?? null;
		if (!user) return 0;

		const roleIds = new Set<string>(user.roleIds || []);
		const orgMembership = orgId ? user.orgMemberships?.find((m: OrgMembership) => m.orgId === orgId) : null;
		for (const rid of orgMembership?.roleIds || []) roleIds.add(rid);

		const groupDocs = await this.groupModel.find({ id: { $in: user.groupIds || [] } });
		for (const doc of groupDocs) {
			const group = (doc?.toObject?.() as Group) || doc;
			const inContext = orgId ? group?.orgId === orgId : !group?.orgId;
			if (!inContext) continue;
			for (const rid of group.roleIds || []) roleIds.add(rid);
		}

		if (roleIds.size === 0) return 0;
		const roleDocs = await this.roleModel.find({ id: { $in: [...roleIds] } });

		let max = 0;
		for (const doc of roleDocs) {
			const role = (doc?.toObject?.() as Role) || doc;
			if (!role) continue;
			const isGlobalRole = !role.orgId;
			const applies = orgId
				? role.orgId === orgId || (isGlobalRole && (role.name === SystemRole.SYSTEM || role.name === SystemRole.ADMIN))
				: isGlobalRole;
			if (!applies) continue;
			max = Math.max(max, roleHierarchy(role));
		}
		return max;
	}

	/**
	 * Jerarquía máxima de un conjunto de roles (para validar asignaciones:
	 * nadie puede asignar/editar roles de jerarquía ≥ a la propia).
	 */
	async getRolesMaxHierarchy(roleIds: readonly string[]): Promise<number> {
		if (!roleIds.length) return 0;
		const roleDocs = await this.roleModel.find({ id: { $in: [...roleIds] } });
		let max = 0;
		for (const doc of roleDocs) {
			const role = (doc?.toObject?.() as Role) || doc;
			if (role) max = Math.max(max, roleHierarchy(role));
		}
		return max;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Invalidación de cache
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Invalida cache para un usuario específico
	 */
	invalidateUser(userId: string): void {
		for (const key of this.#cache.keys()) {
			if (key.startsWith(`${userId}:`)) {
				this.#cache.delete(key);
			}
		}
	}

	/**
	 * Invalida cache para usuarios de un grupo
	 * Por eficiencia, limpia la cache
	 */
	invalidateGroup(_groupId: string): void {
		// Limpiar la cache ya que requeriría query para saber qué usuarios afectar
		this.#cache.clear();
	}

	/**
	 * Invalida cache para usuarios con un rol específico
	 * Por eficiencia, limpia la cache
	 */
	invalidateRole(_roleId: string): void {
		// Limpiar la cache ya que requeriría query para saber qué usuarios afectar
		this.#cache.clear();
	}

	/**
	 * Invalida la cache
	 */
	invalidateAll(): void {
		this.#cache.clear();
	}
}
