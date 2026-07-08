import type { Model } from "mongoose";
import type { Group, User } from "@common/types/identity/index.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import { generateId } from "@common/utils/crypto.ts";
import { escapeRegex } from "@common/utils/escape.ts";
import { forEachPage } from "@common/utils/batch.ts";
import { type AuthVerifierGetter, PermissionChecker } from "@common/types/auth-verifier.ts";
import { IdentityScopes, RESOURCE_NAME } from "@common/types/identity/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.js";
import type { UserManager } from "./users.js";

/** Límite por defecto de resultados de búsqueda de grupos. */
const DEFAULT_SEARCH_LIMIT = 10;
/** Máximo duro de resultados de búsqueda (se clampa en el DAO, aunque el endpoint valide). */
const MAX_SEARCH_LIMIT = 50;
/** Máximo duro de un listado de grupos (una respuesta sin límite es un DoS accidental). */
const MAX_LIST_LIMIT = 500;

export class GroupManager {
	readonly #permissionChecker: PermissionChecker;

	constructor(
		private readonly groupModel: Model<any>,
		private readonly userManager: UserManager,
		private readonly logger: ILogger,
		getAuthVerifier: AuthVerifierGetter = () => null
	) {
		this.#permissionChecker = new PermissionChecker(getAuthVerifier, "GroupManager", RESOURCE_NAME);
	}

	/**
	 * Crea un grupo
	 * @param token Token de autenticación (requerido para verificar permisos)
	 * @param orgId Organización a la que pertenece el grupo (undefined = global)
	 */
	async createGroup(name: string, description: string, roleIds?: string[], token?: string, orgId?: string): Promise<Group> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, IdentityScopes.GROUPS, orgId);

		try {
			const groupId = generateId();
			const group: Group = {
				id: groupId,
				name,
				description,
				roleIds: roleIds || [],
				orgId: orgId || null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await this.groupModel.create(group);
			this.logger.logDebug(`Grupo creado: ${name}`);
			return group;
		} catch (error) {
			this.logger.logError(`Error creando grupo: ${error}`);
			throw error;
		}
	}

	/**
	 * Obtiene un grupo por ID
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getGroup(groupId: string, token?: string): Promise<Group | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.GROUPS);

		try {
			const doc = await this.groupModel.findOne({ id: groupId });
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error obteniendo grupo: ${error}`);
			return null;
		}
	}

	/**
	 * Devuelve datos públicos mínimos (nombre + descripción) para mostrar
	 * los grupos asignados a recursos como issues/comentarios sin requerir
	 * permisos de lectura sobre `groups`. La cardinalidad se limita para
	 * mitigar abusos.
	 */
	async getPublicProfiles(groupIds: readonly string[]): Promise<Map<string, { name: string; description?: string }>> {
		const out = new Map<string, { name: string; description?: string }>();
		const ids = Array.from(new Set(groupIds.filter(Boolean))).slice(0, 50);
		if (ids.length === 0) return out;
		try {
			const docs = await this.groupModel
				.find({ id: { $in: ids } })
				.select({ id: 1, name: 1, description: 1 })
				.lean();
			for (const d of docs) {
				out.set(d.id, { name: d.name, description: d.description });
			}
		} catch (error) {
			this.logger.logError(`Error obteniendo perfiles públicos de grupos: ${error}`);
		}
		return out;
	}

	/**
	 * Actualiza un grupo
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async updateGroup(groupId: string, updates: Partial<Group>, token?: string): Promise<Group> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.GROUPS);

		try {
			updates.updatedAt = new Date();
			const updated = await this.groupModel.findOneAndUpdate({ id: groupId }, updates, { new: true });
			if (!updated) throw new Error(`Grupo ${groupId} no encontrado`);
			this.logger.logDebug(`Grupo actualizado: ${groupId}`);
			return updated.toObject?.() || updated;
		} catch (error) {
			this.logger.logError(`Error actualizando grupo: ${error}`);
			throw error;
		}
	}

	/**
	 * Elimina un grupo
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async deleteGroup(groupId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.GROUPS);

		try {
			await this.userManager.removeGroupFromAll(groupId, token);
			await this.groupModel.deleteOne({ id: groupId });
			this.logger.logDebug(`Grupo eliminado: ${groupId}`);
		} catch (error) {
			this.logger.logError(`Error eliminando grupo: ${error}`);
			throw error;
		}
	}

	/**
	 * Elimina TODOS los grupos de una organización con cascade.
	 * Usado por OrgManager al eliminar una organización.
	 */
	async deleteAllForOrg(orgId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.GROUPS);

		// Cascade paginado por cursor: no materializa todos los grupos de la org en memoria.
		const total = await forEachPage<{ id: string }>(
			(afterId, limit) =>
				this.groupModel
					.find(afterId ? { orgId, id: { $gt: afterId } } : { orgId }, { id: 1, _id: 0 })
					.sort({ id: 1 })
					.limit(limit)
					.lean(),
			async (page) => {
				for (const group of page) {
					await this.userManager.removeGroupFromAll(group.id, token);
				}
			}
		);
		await this.groupModel.deleteMany({ orgId });
		this.logger.logDebug(`Todos los grupos de org ${orgId} eliminados con cascade (${total})`);
	}

	/**
	 * Listado paginado de grupos (orden estable por `name` + `id`), separados por contexto.
	 * - Con orgId: solo grupos de esta org
	 * - Sin orgId (admin global): solo grupos globales (orgId === null)
	 * `q` filtra por name/description; devuelve `total` para paginar; `limit` se clampa SIEMPRE.
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getAllGroups(
		token?: string,
		orgId?: string,
		opts: { limit?: number; offset?: number; q?: string } = {}
	): Promise<{ items: Group[]; total: number }> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.GROUPS, orgId);

		try {
			const filter: Record<string, unknown> = orgId ? { orgId } : { $or: [{ orgId: null }, { orgId: { $exists: false } }] };
			if (opts.q) {
				const regex = new RegExp(escapeRegex(opts.q), "i");
				// $and para no pisar el $or del filtro de contexto (grupos globales)
				filter.$and = [{ $or: [{ name: regex }, { description: regex }] }];
			}
			const limit = Math.min(Math.max(opts.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
			const offset = Math.max(opts.offset ?? 0, 0);
			const [docs, total] = await Promise.all([
				this.groupModel.find(filter).sort({ name: 1, id: 1 }).skip(offset).limit(limit),
				this.groupModel.countDocuments(filter),
			]);
			return { items: docs.map((d: any) => d.toObject?.() || d), total };
		} catch (error) {
			this.logger.logError(`Error obteniendo grupos: ${error}`);
			return { items: [], total: 0 };
		}
	}

	/**
	 * Búsqueda incremental de grupos por nombre/descripción (estilo `searchUsers`).
	 * Devuelve hasta `limit` resultados ordenados por nombre.
	 * @param query Texto a buscar (mínimo recomendado: 2 chars)
	 * @param limit Máximo de resultados (default 10)
	 * @param token Token de autenticación
	 * @param orgId Si se proporciona, restringe a grupos de esa org; si no, sólo globales
	 */
	async searchGroups(query: string, limit: number = DEFAULT_SEARCH_LIMIT, token?: string, orgId?: string): Promise<Group[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.GROUPS, orgId);

		try {
			const regex = new RegExp(escapeRegex(query), "i");
			const filter: any = { $or: [{ name: regex }, { description: regex }] };
			if (orgId) filter.orgId = orgId;
			else filter.$and = [{ $or: [{ orgId: null }, { orgId: { $exists: false } }] }];
			const docs = await this.groupModel.find(filter).limit(Math.min(Math.max(limit, 1), MAX_SEARCH_LIMIT));
			return docs.map((d: any) => d.toObject?.() || d);
		} catch (error) {
			this.logger.logError(`Error buscando grupos: ${error}`);
			return [];
		}
	}

	/**
	 * Agrega un usuario a un grupo (solo modifica user.groupIds)
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async addUserToGroup(userId: string, groupId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, IdentityScopes.GROUPS | IdentityScopes.USERS);

		try {
			const group = await this.groupModel.findOne({ id: groupId });
			if (!group) throw new Error(`Grupo ${groupId} no encontrado`);
			await this.userManager.addToGroup(userId, groupId, token);
			this.logger.logDebug(`Usuario ${userId} agregado al grupo ${groupId}`);
		} catch (error) {
			this.logger.logError(`Error agregando usuario a grupo: ${error}`);
			throw error;
		}
	}

	/**
	 * Remueve un usuario de un grupo (solo modifica user.groupIds)
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async removeUserFromGroup(userId: string, groupId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.GROUPS | IdentityScopes.USERS);

		try {
			await this.userManager.removeFromGroup(userId, groupId, token);
			this.logger.logDebug(`Usuario ${userId} removido del grupo ${groupId}`);
		} catch (error) {
			this.logger.logError(`Error removiendo usuario del grupo: ${error}`);
			throw error;
		}
	}

	/**
	 * Obtiene todos los usuarios que pertenecen a un grupo
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getGroupUsers(groupId: string, token?: string): Promise<User[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.GROUPS | IdentityScopes.USERS);

		try {
			return await this.userManager.getUsersByGroup(groupId, token);
		} catch (error) {
			this.logger.logError(`Error obteniendo usuarios del grupo: ${error}`);
			return [];
		}
	}

	/**
	 * Remueve un roleId de todos los grupos.
	 * Usado por RoleManager al eliminar un rol.
	 */
	async removeRoleFromAll(roleId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.GROUPS);

		await this.groupModel.updateMany({ roleIds: roleId }, { $pull: { roleIds: roleId } });
	}
}
