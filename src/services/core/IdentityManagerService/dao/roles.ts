import type { Model } from "mongoose";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import { generateId } from "@common/utils/crypto.ts";
import { IdentityScopes, RESOURCE_NAME } from "@common/types/identity/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.ts";
import { type AuthVerifierGetter, PermissionChecker } from "@common/types/auth-verifier.ts";
import type { Permission, Role } from "@common/types/identity/index.ts";
import { PREDEFINED_ROLES, ORG_PREDEFINED_ROLES } from "../defaults/systemRoles.ts";
import { isGlobalOnlyResource } from "@common/types/resources.ts";
import type { UserManager } from "./users.js";
import type { GroupManager } from "./groups.js";
import type { IOperationsService } from "@common/types/operations/IOperationsService.js";
import type { Step } from "../../../core/OperationsService/types.ts";
import { forEachPage } from "@common/utils/batch.ts";

/** Máximo duro de un listado de roles (una respuesta sin límite es un DoS accidental). */
const MAX_LIST_LIMIT = 500;

/**
 * Un rol de organización no puede portar permisos de recursos `globalOnly`
 * (security, modules): son de gestión de plataforma y sólo valen en roles globales.
 */
function assertNoGlobalOnlyPerms(permissions: Permission[] | undefined, orgId?: string | null): void {
	if (!orgId || !permissions?.length) return;
	const offending = permissions.find((p) => isGlobalOnlyResource(p.resource));
	if (offending) {
		throw new Error(`GLOBAL_ONLY_RESOURCE: el recurso '${offending.resource}' sólo puede asignarse en roles globales`);
	}
}

export class RoleManager {
	readonly #permissionChecker: PermissionChecker;
	readonly #operations: IOperationsService;

	constructor(
		private readonly roleModel: Model<any>,
		private readonly userManager: UserManager,
		private readonly groupManager: GroupManager,
		private readonly logger: ILogger,
		operations: IOperationsService,
		getAuthVerifier: AuthVerifierGetter = () => null
	) {
		this.#permissionChecker = new PermissionChecker(getAuthVerifier, "RoleManager", RESOURCE_NAME);
		this.#operations = operations;
	}

	/**
	 * Inicializa Y SINCRONIZA roles predefinidos del sistema o de una organización.
	 * Sin orgId: roles globales (PREDEFINED_ROLES). Con orgId: roles de organización
	 * (ORG_PREDEFINED_ROLES, sin SYSTEM ni roles global-only).
	 *
	 * Si el rol ya existe (`isCustom: false`, no editable vía API), sus
	 * `permissions`/`description`/`hierarchy` se actualizan cuando difieren de la
	 * definición en código — así los cambios en systemRoles.ts llegan a bases ya
	 * seedeadas. Devuelve `true` si hubo cambios (el caller debe invalidar el cache
	 * de permisos). No requiere token (es proceso de inicialización).
	 */
	async initializePredefinedRoles(orgId?: string): Promise<boolean> {
		const roles = orgId ? ORG_PREDEFINED_ROLES : PREDEFINED_ROLES;
		const scopeLabel = orgId ? ` [org: ${orgId}]` : " [global]";
		let changed = false;

		for (const roleData of roles) {
			try {
				// Chequeo de duplicado incluye orgId para evitar colisiones de nombre entre contextos
				const filter = orgId ? { name: roleData.name, orgId } : { name: roleData.name, orgId: null };

				const existingDoc = await this.roleModel.findOne(filter);
				if (!existingDoc) {
					await this.roleModel.create({
						id: generateId(),
						name: roleData.name,
						description: roleData.description,
						permissions: roleData.permissions,
						hierarchy: roleData.hierarchy,
						isCustom: false,
						orgId: orgId || null,
						createdAt: new Date(),
					});
					changed = true;
					this.logger.logDebug(`Rol predefinido creado: ${roleData.name}${scopeLabel}`);
					continue;
				}

				const existing: Role = existingDoc.toObject?.() || existingDoc;
				if (existing.isCustom) continue; // colisión de nombre con un rol custom: no tocar

				if (this.#predefinedRoleOutdated(existing, roleData)) {
					await this.roleModel.updateOne(filter, {
						description: roleData.description,
						permissions: roleData.permissions,
						hierarchy: roleData.hierarchy,
					});
					changed = true;
					this.logger.logInfo(`Rol predefinido sincronizado con systemRoles.ts: ${roleData.name}${scopeLabel}`);
				}
			} catch (error) {
				this.logger.logError(`Error inicializando rol ${roleData.name}: ${error}`);
			}
		}

		return changed;
	}

	/** True si el doc seedeado difiere de la definición en código (permissions/description/hierarchy). */
	#predefinedRoleOutdated(existing: Role, def: (typeof PREDEFINED_ROLES)[number]): boolean {
		if (existing.description !== def.description) return true;
		if ((existing.hierarchy ?? null) !== (def.hierarchy ?? null)) return true;
		const byText = (a: string, b: string) => a.localeCompare(b);
		const current = (existing.permissions || []).map((p) => `${p.resource}|${p.action}|${p.scope}`).sort(byText);
		const expected = def.permissions.map((p) => `${p.resource}|${p.action}|${p.scope}`).sort(byText);
		return current.length !== expected.length || current.some((v, i) => v !== expected[i]);
	}

	/**
	 * Crea un rol personalizado
	 * @param token Token de autenticación (requerido para verificar permisos)
	 * @param orgId Organización a la que pertenece el rol (undefined = global)
	 * @param hierarchy Orden del rol (default 100); el endpoint valida que sea menor a la del actor
	 */
	async createRole(
		name: string,
		description: string,
		permissions?: Permission[],
		token?: string,
		orgId?: string,
		hierarchy?: number
	): Promise<Role> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, IdentityScopes.ROLES, orgId);
		assertNoGlobalOnlyPerms(permissions, orgId);

		try {
			const roleId = generateId();
			const role: Role = {
				id: roleId,
				name,
				description,
				permissions: permissions || [],
				hierarchy: hierarchy ?? 100,
				isCustom: true,
				orgId: orgId || null,
				createdAt: new Date(),
			};

			await this.roleModel.create(role);
			this.logger.logDebug(`Rol personalizado creado: ${name}`);
			return role;
		} catch (error) {
			this.logger.logError(`Error creando rol: ${error}`);
			throw error;
		}
	}

	/**
	 * Obtiene un rol por ID
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getRole(roleId: string, token?: string): Promise<Role | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.ROLES);

		try {
			const doc = await this.roleModel.findOne({ id: roleId });
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error obteniendo rol: ${error}`);
			return null;
		}
	}

	/**
	 * Obtiene múltiples roles por sus IDs en una sola consulta
	 */
	async getRolesByIds(roleIds: string[], token?: string, orgId?: string): Promise<Role[]> {
		if (!roleIds.length) return [];
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.ROLES, orgId);
		try {
			const docs = await this.roleModel.find({ id: { $in: roleIds } });
			return docs.map((d: any) => d.toObject?.() || d);
		} catch (error) {
			this.logger.logError(`Error obteniendo roles por IDs: ${error}`);
			return [];
		}
	}

	/**
	 * Obtiene un rol por nombre
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getRoleByName(name: string, token?: string): Promise<Role | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.ROLES);

		try {
			const doc = await this.roleModel.findOne({ name });
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error obteniendo rol por nombre: ${error}`);
			return null;
		}
	}

	/**
	 * Actualiza un rol
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async updateRole(roleId: string, updates: Partial<Role>, token?: string): Promise<Role> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.ROLES);

		if (updates.permissions?.length) {
			const current = await this.roleModel.findOne<Role>({ id: roleId }).lean();
			assertNoGlobalOnlyPerms(updates.permissions, updates.orgId ?? current?.orgId);
		}

		try {
			const updated = await this.roleModel.findOneAndUpdate({ id: roleId }, updates, { new: true });
			if (!updated) throw new Error(`Rol ${roleId} no encontrado`);
			this.logger.logDebug(`Rol actualizado: ${roleId}`);
			return updated.toObject?.() || updated;
		} catch (error) {
			this.logger.logError(`Error actualizando rol: ${error}`);
			throw error;
		}
	}

	/**
	 * Limpia todas las referencias a un roleId delegando a los managers correspondientes.
	 */
	async #cascadeCleanupRole(roleId: string, token?: string): Promise<void> {
		await this.userManager.removeRoleFromAll(roleId, token);
		await this.groupManager.removeRoleFromAll(roleId, token);
	}

	/**
	 * Elimina un rol (solo custom, protege predefinidos globales)
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async deleteRole(roleId: string, token?: string, resumeFromStep?: number): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.ROLES);

		const role = await this.roleModel.findOne<Role>({ id: roleId }).lean();
		if (!role) {
			throw new Error(`Rol ${roleId} no encontrado`);
		}
		if (!role.isCustom) {
			throw new Error("No se pueden eliminar roles predefinidos");
		}

		// Steps defined in the DAO: cascade cleanup then delete
		const steps: Step[] = [
			// 0: Remove role from all users
			() => this.userManager.removeRoleFromAll(roleId, token),
			// 1: Remove role from all groups
			() => this.groupManager.removeRoleFromAll(roleId, token),
			// 2: Delete the role document
			async () => {
				const result = await this.roleModel.deleteOne({ id: roleId });
				if (result.deletedCount === 0) {
					throw new Error(`No se pudo eliminar el rol ${roleId}`);
				}
			},
		];

		const startIdx = resumeFromStep ?? 0;

		const failedStep = await this.#operations.stepper(startIdx, "delete-role", roleId, steps);
		if (failedStep !== null) {
			const err = new Error(`deleteRole failed at step ${failedStep}`);
			(err as any).failedStep = failedStep;
			throw err;
		}

		this.logger.logOk(`Rol eliminado: ${roleId} (${role.name})`);
	}

	/**
	 * Elimina TODOS los roles de una organización (custom + predefinidos de org) con cascade.
	 * Usado por OrgManager al eliminar una organización.
	 */
	async deleteAllForOrg(orgId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.ROLES);

		// Cascade paginado por cursor: no materializa todos los roles de la org en memoria.
		const total = await forEachPage<{ id: string }>(
			(afterId, limit) =>
				this.roleModel
					.find(afterId ? { orgId, id: { $gt: afterId } } : { orgId }, { id: 1, _id: 0 })
					.sort({ id: 1 })
					.limit(limit)
					.lean(),
			async (page) => {
				for (const role of page) {
					await this.#cascadeCleanupRole(role.id, token);
				}
			}
		);
		await this.roleModel.deleteMany({ orgId });
		this.logger.logDebug(`Todos los roles de org ${orgId} eliminados con cascade (${total})`);
	}

	/**
	 * Obtiene todos los roles, separados por contexto.
	 * - Con orgId: roles predefinidos de la org + custom de la org + predefinidos globales (como referencia)
	 * - Sin orgId (admin global): solo roles globales (orgId === null)
	 * @param token Token de autenticación (requerido para verificar permisos)
	 * @param orgId Si se proporciona, retorna roles de esta org + globales predefinidos
	 */
	async getAllRoles(token?: string, orgId?: string): Promise<Role[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.ROLES, orgId);

		try {
			const filter = orgId
				? {
						$or: [
							{ orgId }, // Roles de esta org (predefinidos + custom)
							{ orgId: null, isCustom: false }, // Predefinidos globales (referencia readonly)
						],
					}
				: { orgId: null }; // Solo roles globales
			const docs = await this.roleModel.find(filter).limit(MAX_LIST_LIMIT);
			return docs.map((d: any) => d.toObject?.() || d);
		} catch (error) {
			this.logger.logError(`Error obteniendo roles: ${error}`);
			return [];
		}
	}

	/**
	 * Obtiene los roles predefinidos
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getPredefinedRoles(token?: string): Promise<Role[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.ROLES);

		try {
			const docs = await this.roleModel.find({ isCustom: false }).limit(MAX_LIST_LIMIT);
			return docs.map((d: any) => d.toObject?.() || d);
		} catch (error) {
			this.logger.logError(`Error obteniendo roles predefinidos: ${error}`);
			return [];
		}
	}
}
