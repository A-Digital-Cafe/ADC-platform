import type { Model } from "mongoose";
import { Permission, ResolvedPermission } from "@common/types/identity/Permission.ts";
import type { User, OrgMembership } from "@common/types/identity/User.ts";
import { roleHierarchy, type Role } from "@common/types/identity/Role.ts";
import type { Group } from "@common/types/identity/Group.ts";
import type { Organization } from "@common/types/identity/Organization.ts";
import LRUCache from "../../../../utils/performance/LRUCache.ts";
import { hasPermission } from "@common/utils/perms.ts";
import {
	type FinalPerms,
	filterGlobalOnly,
	asPlain,
	isGroupInContext,
	isDirectRoleInContext,
	isMembershipRoleInContext,
	isCrossOrgGlobalRole,
	applyLevel,
	toResolvedPermissions,
} from "./permissionHierarchy.ts";

interface PermissionCacheEntry {
	permissions: ResolvedPermission[];
	timestamp: number;
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
		// Permisos finales por recurso; cada nivel hace override del anterior.
		const finalPerms: FinalPerms = new Map();

		// 5. Org permissions (base, menor prioridad)
		applyLevel(finalPerms, await this.#orgLevelPerms(orgId), "org");

		const user = await this.#findUser(userId);
		if (!user) return [];

		const validGroups = await this.#contextGroups(user, orgId);

		// 4. Group roles → 3. Group direct → 2. User roles → 1. User direct
		applyLevel(finalPerms, await this.#groupRoleLevelPerms(validGroups), "groupRole");
		applyLevel(finalPerms, this.#groupLevelPerms(validGroups), "group");
		applyLevel(finalPerms, await this.#userRoleLevelPerms(user, orgId), "userRole");

		// Los permisos directos sólo aplican en contexto personal y tampoco portan
		// recursos globalOnly: éstos se delegan únicamente por rol global
		// (auditables en la UI de roles).
		if (!orgId && user.permissions?.length) {
			applyLevel(finalPerms, filterGlobalOnly(user.permissions, false), "user");
		}

		return toResolvedPermissions(finalPerms);
	}

	async #findUser(userId: string): Promise<User | null> {
		return asPlain<User>(await this.userModel.findOne({ id: userId }));
	}

	/** Roles por id en una sola query (mapa vacío si no hay ids). */
	async #rolesById(roleIds: string[]): Promise<Map<string, Role>> {
		if (!roleIds.length) return new Map();
		const docs = await this.roleModel.find({ id: { $in: roleIds } });
		return new Map(docs.map((d) => {
			const role = asPlain<Role>(d) as Role;
			return [role.id, role];
		}));
	}

	/** Permisos base de la organización (nivel "org"). */
	async #orgLevelPerms(orgId?: string): Promise<Permission[]> {
		if (!orgId || !this.orgModel) return [];
		const org = asPlain<Organization>(await this.orgModel.findOne({ $or: [{ orgId }, { slug: orgId.toLowerCase() }] }));
		return org?.permissions?.length ? filterGlobalOnly(org.permissions, false) : [];
	}

	/** Grupos del usuario que aplican al contexto (org actual o personal). */
	async #contextGroups(user: User, orgId?: string): Promise<Group[]> {
		const groupDocs = await this.groupModel.find({ id: { $in: user.groupIds || [] } });
		const groups = groupDocs.map((d) => asPlain<Group>(d));
		return groups.filter((g): g is Group => isGroupInContext(g, orgId));
	}

	/**
	 * Nivel "groupRole": roles de todos los grupos del contexto.
	 * Sólo un rol GLOBAL adjuntado a un grupo conserva permisos globalOnly.
	 */
	async #groupRoleLevelPerms(validGroups: Group[]): Promise<Permission[]> {
		const rolesMap = await this.#rolesById(validGroups.flatMap((g) => g.roleIds || []));
		const perms: Permission[] = [];
		for (const group of validGroups) {
			for (const roleId of group.roleIds || []) {
				const role = rolesMap.get(roleId);
				if (role) perms.push(...filterGlobalOnly(role.permissions, !role.orgId));
			}
		}
		return perms;
	}

	/** Nivel "group": permisos directos de los grupos del contexto. */
	#groupLevelPerms(validGroups: Group[]): Permission[] {
		const perms: Permission[] = [];
		for (const group of validGroups) {
			if (group.permissions?.length) perms.push(...filterGlobalOnly(group.permissions, false));
		}
		return perms;
	}

	/**
	 * Nivel "userRole": roles directos (contexto personal) + roles de la
	 * membresía de la org. Los roles de org NUNCA portan permisos globalOnly;
	 * SYSTEM/ADMIN globales aplican cross-org sin filtrar.
	 */
	async #userRoleLevelPerms(user: User, orgId?: string): Promise<Permission[]> {
		const orgMembership = orgId ? user.orgMemberships?.find((m: OrgMembership) => m.orgId === orgId) : null;
		const rolesMap = await this.#rolesById([...(user.roleIds || []), ...(orgMembership?.roleIds || [])]);
		const perms: Permission[] = [];

		// 2b. Roles de orgMembership (si hay orgId)
		if (orgId && orgMembership) {
			for (const roleId of orgMembership.roleIds || []) {
				const role = rolesMap.get(roleId);
				if (!role) continue;
				if (isMembershipRoleInContext(role, orgId) || isCrossOrgGlobalRole(role)) {
					perms.push(...filterGlobalOnly(role.permissions, !role.orgId));
				}
			}
		}

		// 2a. User roles directos
		for (const roleId of user.roleIds || []) {
			const role = rolesMap.get(roleId);
			if (role && isDirectRoleInContext(role, orgId)) {
				perms.push(...filterGlobalOnly(role.permissions, !role.orgId));
			}
			// En contexto de org, SYSTEM/ADMIN globales aplican para gestión cross-org.
			if (orgId && isCrossOrgGlobalRole(role ?? null)) {
				perms.push(...(role as Role).permissions);
			}
		}
		return perms;
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
		const user = await this.#findUser(userId);
		if (!user) return 0;

		const roleIds = await this.#contextRoleIds(user, orgId);
		if (roleIds.size === 0) return 0;

		const roleDocs = await this.roleModel.find({ id: { $in: [...roleIds] } });
		let max = 0;
		for (const doc of roleDocs) {
			const role = asPlain<Role>(doc);
			if (role && this.#roleAppliesInContext(role, orgId)) max = Math.max(max, roleHierarchy(role));
		}
		return max;
	}

	/** roleIds del usuario en el contexto: directos + membresía de la org + grupos del contexto. */
	async #contextRoleIds(user: User, orgId?: string): Promise<Set<string>> {
		const roleIds = new Set<string>(user.roleIds || []);
		const orgMembership = orgId ? user.orgMemberships?.find((m: OrgMembership) => m.orgId === orgId) : null;
		for (const rid of orgMembership?.roleIds || []) roleIds.add(rid);

		for (const group of await this.#contextGroups(user, orgId)) {
			for (const rid of group.roleIds || []) roleIds.add(rid);
		}
		return roleIds;
	}

	/** Mismos criterios que la resolución de permisos (roles de la org, o globales; cross-org sólo SYSTEM/ADMIN). */
	#roleAppliesInContext(role: Role, orgId?: string): boolean {
		if (!orgId) return !role.orgId;
		return role.orgId === orgId || isCrossOrgGlobalRole(role);
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
