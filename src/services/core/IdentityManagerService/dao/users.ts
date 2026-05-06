import type { Model } from "mongoose";
import type { User, LinkedAccount } from "@common/types/identity/User.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import { generateId, hashPassword, verifyPassword } from "@common/utils/crypto.ts";
import { type AuthVerifierGetter, PermissionChecker } from "@common/types/auth-verifier.ts";
import { IdentityScopes, RESOURCE_NAME } from "@common/types/identity/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.ts";
import { resolveUserAvatar } from "@common/utils/avatar.ts";

export type UserAuthenticationResult = Partial<User> | { id: string; isActive: boolean } | { id: string; wrongPassword: boolean } | null;

export class UserManager {
	readonly #permissionChecker: PermissionChecker;

	constructor(
		private readonly userModel: Model<any>,
		private readonly logger: ILogger,
		getAuthVerifier: AuthVerifierGetter = () => null
	) {
		this.#permissionChecker = new PermissionChecker(getAuthVerifier, "UserManager", RESOURCE_NAME);
	}

	/**
	 * Autentica un usuario con username y password
	 * No requiere token (es el proceso de login)
	 */
	async authenticate(username: string, password: string): Promise<UserAuthenticationResult> {
		try {
			const doc = await this.userModel.findOne({ username });
			const user: User | null = doc?.toObject?.() || doc || null;

			if (!user) return null;

			if (!user?.isActive) return { id: user.id, isActive: false };

			const valid = verifyPassword(password, user.passwordHash);
			if (!valid) return { id: user.id, wrongPassword: true };

			user.lastLogin = new Date();
			await this.userModel.findOneAndUpdate({ id: user.id }, { lastLogin: user.lastLogin });

			return user;
		} catch (error) {
			this.logger.logError(`Error autenticando usuario: ${error}`);
			return null;
		}
	}

	/**
	 * Crea un nuevo usuario
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async createUser(username: string, password: string, roleIds?: string[], token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, IdentityScopes.USERS);

		try {
			const userId = generateId();
			const user: User = {
				id: userId,
				username,
				passwordHash: hashPassword(password),
				roleIds: roleIds || [],
				groupIds: [],
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await this.userModel.create(user);
			this.logger.logDebug(`Usuario creado: ${username}`);
			return user;
		} catch (error: any) {
			if (error.code === 11000) {
				throw new Error(`Usuario ${username} ya existe`);
			}
			throw error;
		}
	}

	/**
	 * Obtiene un usuario por ID
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getUser(userId: string, token?: string): Promise<User | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS, {
			allowIf: async (callerId) => callerId === userId,
		});

		try {
			const doc = await this.userModel.findOne({ id: userId });
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error obteniendo usuario: ${error}`);
			return null;
		}
	}

	/**
	 * Devuelve datos públicos mínimos para mostrar perfiles (avatar + username)
	 * de un conjunto de usuarios. Sin verificación de permisos: estos campos
	 * ya son públicos cuando un usuario aparece como autor de un comentario,
	 * artículo, etc. Limita la cardinalidad para mitigar abusos.
	 */
	async getPublicProfiles(userIds: readonly string[]): Promise<Map<string, { username?: string; avatar?: string }>> {
		const out = new Map<string, { username?: string; avatar?: string }>();
		const ids = Array.from(new Set(userIds.filter(Boolean))).slice(0, 50);
		if (ids.length === 0) return out;
		try {
			const docs = await this.userModel
				.find({ id: { $in: ids } })
				.select({ id: 1, username: 1, avatar: 1, metadata: 1, linkedAccounts: 1 })
				.lean();
			for (const d of docs as any[]) {
				out.set(d.id, { username: d.username, avatar: resolveUserAvatar(d) });
			}
		} catch (error) {
			this.logger.logError(`Error obteniendo perfiles públicos: ${error}`);
		}
		return out;
	}

	/**
	 * Obtiene un usuario por username
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getUserByUsername(username: string, token?: string): Promise<User | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		try {
			const doc = await this.userModel.findOne({ username });
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error obteniendo usuario por username: ${error}`);
			return null;
		}
	}

	/* Check if an username is already in use. No Permisson required */
	async existUserByName(username: string): Promise<boolean> {
		try {
			const doc = await this.userModel.findOne({ username });
			return !!doc;
		} catch (error) {
			this.logger.logError(`Error obteniendo usuario por username: ${error}`);
			return false;
		}
	}

	/**
	 * Obtiene un usuario por email
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getUserByEmail(email: string, token?: string): Promise<User | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		try {
			const doc = await this.userModel.findOne({ email });
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error obteniendo usuario por email: ${error}`);
			return null;
		}
	}

	/**
	 * Verifica si existe un usuario con el username O email dados (una sola query)
	 * Retorna cuál campo ya existe para dar feedback específico
	 */
	async existsByUsernameOrEmail(username: string, email: string, token?: string): Promise<{ exists: boolean; field?: "username" | "email" }> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		try {
			const doc = await this.userModel.findOne({ $or: [{ username }, { email }] });
			if (!doc) return { exists: false };

			const user = doc.toObject?.() || doc;
			if (user.username === username) return { exists: true, field: "username" };
			return { exists: true, field: "email" };
		} catch (error) {
			this.logger.logError(`Error verificando existencia de usuario: ${error}`);
			return { exists: false };
		}
	}

	/**
	 * Busca usuario por providerId en metadata O por email (query optimizada)
	 * Útil para login OAuth donde el usuario puede existir por provider previo o por email
	 */
	async findByProviderIdOrEmail(providerIdField: string, providerId: string, email?: string, token?: string): Promise<User | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		try {
			const conditions: any[] = [{ [`metadata.${providerIdField}`]: providerId }];
			if (email) {
				conditions.push({ email });
			}
			const doc = await this.userModel.findOne({ $or: conditions });
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error buscando usuario por provider o email: ${error}`);
			return null;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Linked Accounts (OAuth external providers)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Busca usuario por linked account (provider + providerId con status "linked")
	 * Reemplaza búsqueda por metadata.discordId
	 */
	async findByLinkedExternalAccount(provider: string, providerId: string, token?: string): Promise<User | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		try {
			const doc = await this.userModel.findOne({
				linkedAccounts: {
					$elemMatch: { provider, providerId, status: "linked" },
				},
			});
			return doc?.toObject?.() || doc || null;
		} catch (error) {
			this.logger.logError(`Error buscando usuario por linked account: ${error}`);
			return null;
		}
	}

	/**
	 * Vincula una cuenta externa al usuario.
	 * Valida que no exista otro usuario con ese providerId activo para el mismo provider.
	 */
	async linkExternalAccount(userId: string, account: LinkedAccount, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		// Anti-collision: verificar que ningún OTRO usuario tiene este provider+id activo
		const existing = await this.userModel.findOne({
			id: { $ne: userId },
			linkedAccounts: {
				$elemMatch: { provider: account.provider, providerId: account.providerId, status: "linked" },
			},
		});
		if (existing) {
			throw new Error(`La cuenta ${account.provider}:${account.providerId} ya está vinculada a otro usuario`);
		}

		// Verificar si ya existe una entrada para este provider (puede estar "unlinked")
		const userDoc = await this.userModel.findOne({
			id: userId,
			"linkedAccounts.provider": account.provider,
			"linkedAccounts.providerId": account.providerId,
		});

		if (userDoc) {
			// Re-vincular: cambiar status a "linked", actualizar linkedAt y datos
			const updated = await this.userModel.findOneAndUpdate(
				{
					id: userId,
					linkedAccounts: {
						$elemMatch: { provider: account.provider, providerId: account.providerId },
					},
				},
				{
					$set: {
						"linkedAccounts.$.status": "linked",
						"linkedAccounts.$.linkedAt": new Date(),
						"linkedAccounts.$.providerUsername": account.providerUsername,
						"linkedAccounts.$.providerAvatar": account.providerAvatar,
						"linkedAccounts.$.unlinkedAt": undefined,
					},
					updatedAt: new Date(),
				},
				{ new: true }
			);
			if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
			this.logger.logDebug(`Cuenta ${account.provider} re-vinculada para usuario ${userId}`);
			return updated.toObject?.() || updated;
		}

		// Nueva vinculación: push al array
		const updated = await this.userModel.findOneAndUpdate(
			{ id: userId },
			{
				$push: {
					linkedAccounts: {
						provider: account.provider,
						providerId: account.providerId,
						providerUsername: account.providerUsername,
						providerAvatar: account.providerAvatar,
						status: "linked",
						linkedAt: new Date(),
					},
				},
				updatedAt: new Date(),
			},
			{ new: true }
		);
		if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
		this.logger.logDebug(`Cuenta ${account.provider} vinculada para usuario ${userId}`);
		return updated.toObject?.() || updated;
	}

	/**
	 * Desvincula una cuenta externa (cambia status a "unlinked", no elimina la entrada)
	 */
	async unlinkExternalAccount(userId: string, provider: string, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		const updated = await this.userModel.findOneAndUpdate(
			{
				id: userId,
				linkedAccounts: {
					$elemMatch: { provider, status: "linked" },
				},
			},
			{
				$set: {
					"linkedAccounts.$.status": "unlinked",
					"linkedAccounts.$.unlinkedAt": new Date(),
				},
				updatedAt: new Date(),
			},
			{ new: true }
		);

		if (!updated) throw new Error(`No se encontró cuenta ${provider} vinculada para usuario ${userId}`);
		this.logger.logDebug(`Cuenta ${provider} desvinculada para usuario ${userId}`);
		return updated.toObject?.() || updated;
	}

	/**
	 * Actualiza un usuario
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async updateUser(userId: string, updates: Partial<User>, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		try {
			updates.updatedAt = new Date();
			const updated = await this.userModel.findOneAndUpdate({ id: userId }, updates, { new: true });
			if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
			return updated.toObject?.() || updated;
		} catch (error) {
			this.logger.logError(`Error actualizando usuario: ${error}`);
			throw error;
		}
	}

	/**
	 * Actualiza (merge shallow por clave top-level) el objeto `metadata` del propio usuario.
	 */
	async updateOwnMetadata(userId: string, partial: Record<string, unknown>, token?: string): Promise<User> {
		const callerId = await this.#permissionChecker.resolveUserId(token);
		if (callerId && callerId !== userId) {
			throw new Error(`[UserManager] No se puede actualizar metadata de otro usuario (caller=${callerId}, target=${userId})`);
		}
		const current = await this.userModel.findOne({ id: userId });
		if (!current) throw new Error(`Usuario ${userId} no encontrado`);
		const currentMeta = (current.toObject?.() || current).metadata || {};
		const nextMeta = { ...currentMeta, ...partial };
		const updated = await this.userModel.findOneAndUpdate({ id: userId }, { metadata: nextMeta, updatedAt: new Date() }, { new: true });
		if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
		return updated.toObject?.() || updated;
	}

	/**
	 * Verifica la password de un usuario
	 */
	async verifyUserPassword(userId: string, password: string): Promise<boolean> {
		try {
			const doc = await this.userModel.findOne({ id: userId });
			const user = doc?.toObject?.() || doc;

			if (!user) return false;

			return verifyPassword(password, user.passwordHash);
		} catch (error) {
			this.logger.logError(`Error verificando password: ${error}`);
			return false;
		}
	}

	/**
	 * Actualiza la password de un usuario
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async updatePassword(userId: string, newPassword: string, token?: string): Promise<void> {
		if (token) {
			await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);
		}

		try {
			const passwordHash = hashPassword(newPassword);

			const updated = await this.userModel.findOneAndUpdate(
				{ id: userId },
				{
					passwordHash,
					updatedAt: new Date(),
				}
			);

			if (!updated) {
				throw new Error(`Usuario ${userId} no encontrado`);
			}

			this.logger.logDebug(`Password actualizada para usuario ${userId}`);
		} catch (error) {
			this.logger.logError(`Error actualizando password: ${error}`);
			throw error;
		}
	}

	/**
	 * Elimina un usuario
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async deleteUser(userId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.USERS);

		try {
			await this.userModel.deleteOne({ id: userId });
			this.logger.logDebug(`Usuario eliminado: ${userId}`);
		} catch (error) {
			this.logger.logError(`Error eliminando usuario: ${error}`);
			throw error;
		}
	}

	/**
	 * Obtiene todos los usuarios, opcionalmente filtrados por orgId
	 * @param token Token de autenticación (requerido para verificar permisos)
	 * @param orgId Si se proporciona, filtra usuarios que pertenecen a esta organización
	 */
	async getAllUsers(token?: string, orgId?: string): Promise<User[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS, orgId);

		try {
			const filter = orgId ? { "orgMemberships.orgId": orgId } : {};
			const docs = await this.userModel.find(filter);
			return docs.map((d: any) => d.toObject?.() || d);
		} catch (error) {
			this.logger.logError(`Error obteniendo usuarios: ${error}`);
			return [];
		}
	}

	/**
	 * Busca usuarios por username o email (parcial, case-insensitive)
	 * @param query Texto a buscar
	 * @param limit Máximo de resultados (default 10)
	 * @param token Token de autenticación
	 * @param orgId Si se proporciona, filtra usuarios que pertenecen a esta organización
	 */
	async searchUsers(query: string, limit: number = 10, token?: string, orgId?: string): Promise<User[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS, orgId);

		try {
			const escapedQuery = query.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
			const regex = new RegExp(escapedQuery, "i");
			const filter: any = { $or: [{ username: regex }, { email: regex }] };
			if (orgId) filter["orgMemberships.orgId"] = orgId;
			const docs = await this.userModel.find(filter).limit(limit);
			return docs.map((d: any) => d.toObject?.() || d);
		} catch (error) {
			this.logger.logError(`Error buscando usuarios: ${error}`);
			return [];
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Métodos de membresía por organización
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Agrega membresía a una organización
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async addOrgMembership(userId: string, orgId: string, roleIds: string[] = [], token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, IdentityScopes.USERS | IdentityScopes.ORGANIZATIONS, orgId);

		try {
			const updated = await this.userModel.findOneAndUpdate(
				{ id: userId },
				{
					$addToSet: {
						orgMemberships: { orgId, roleIds, joinedAt: new Date() },
					},
					updatedAt: new Date(),
				},
				{ new: true }
			);
			if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
			this.logger.logDebug(`Usuario ${userId} agregado a organización ${orgId}`);
			return updated.toObject?.() || updated;
		} catch (error) {
			this.logger.logError(`Error agregando membresía de organización: ${error}`);
			throw error;
		}
	}

	/**
	 * Remueve membresía de una organización
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async removeOrgMembership(userId: string, orgId: string, token?: string): Promise<User> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.USERS | IdentityScopes.ORGANIZATIONS, orgId);

		try {
			const updated = await this.userModel.findOneAndUpdate(
				{ id: userId },
				{
					$pull: { orgMemberships: { orgId } },
					updatedAt: new Date(),
				},
				{ new: true }
			);
			if (!updated) throw new Error(`Usuario ${userId} no encontrado`);
			this.logger.logDebug(`Usuario ${userId} removido de organización ${orgId}`);
			return updated.toObject?.() || updated;
		} catch (error) {
			this.logger.logError(`Error removiendo membresía de organización: ${error}`);
			throw error;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Operaciones bulk / cascade (usadas por otros managers vía delegación)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Remueve la membresía de una organización de TODOS los usuarios.
	 * Usado por OrgManager al eliminar una organización.
	 */
	async removeAllOrgMemberships(orgId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		await this.userModel.updateMany({ "orgMemberships.orgId": orgId }, { $pull: { orgMemberships: { orgId } }, updatedAt: new Date() });
	}

	/**
	 * Remueve un roleId de TODOS los usuarios (roleIds directos + orgMemberships).
	 * Usado por RoleManager al eliminar un rol.
	 */
	async removeRoleFromAll(roleId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		await this.userModel.updateMany({ roleIds: roleId }, { $pull: { roleIds: roleId } });
		await this.userModel.updateMany({ "orgMemberships.roleIds": roleId }, { $pull: { "orgMemberships.$[].roleIds": roleId } });
	}

	/**
	 * Remueve un groupId de TODOS los usuarios.
	 * Usado por GroupManager al eliminar un grupo.
	 */
	async removeGroupFromAll(groupId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		await this.userModel.updateMany({ groupIds: groupId }, { $pull: { groupIds: groupId } });
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Operaciones de membresía a grupo (usadas por GroupManager vía delegación)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Agrega un groupId al array groupIds de un usuario.
	 * Usado por GroupManager.addUserToGroup.
	 */
	async addToGroup(userId: string, groupId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		const result = await this.userModel.findOneAndUpdate({ id: userId }, { $addToSet: { groupIds: groupId }, updatedAt: new Date() });
		if (!result) throw new Error(`Usuario ${userId} no encontrado`);
	}

	/**
	 * Remueve un groupId del array groupIds de un usuario.
	 * Usado por GroupManager.removeUserFromGroup.
	 */
	async removeFromGroup(userId: string, groupId: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.USERS);

		const result = await this.userModel.findOneAndUpdate({ id: userId }, { $pull: { groupIds: groupId }, updatedAt: new Date() });
		if (!result) throw new Error(`Usuario ${userId} no encontrado`);
	}

	/**
	 * Obtiene todos los usuarios que pertenecen a un grupo.
	 * Usado por GroupManager.getGroupUsers.
	 */
	async getUsersByGroup(groupId: string, token?: string): Promise<User[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS);

		const docs = await this.userModel.find({ groupIds: groupId });
		return docs.map((d: any) => d.toObject?.() || d);
	}

	/**
	 * Obtiene las organizaciones de un usuario
	 * @param token Token de autenticación (requerido para verificar permisos)
	 */
	async getUserOrganizations(userId: string, token?: string): Promise<string[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.USERS | IdentityScopes.ORGANIZATIONS);

		try {
			const user = await this.userModel.findOne({ id: userId });
			if (!user) return [];
			return user.orgMemberships?.map((m: any) => m.orgId) || [];
		} catch (error) {
			this.logger.logError(`Error obteniendo organizaciones del usuario: ${error}`);
			return [];
		}
	}
}
