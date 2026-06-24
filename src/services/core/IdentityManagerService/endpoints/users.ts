import { RegisterEndpoint, type EndpointCtx } from "../../EndpointManagerService/index.js";
import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { AuthError } from "@common/types/custom-errors/AuthError.js";
import { P } from "@common/types/Permissions.ts";
import type IdentityManagerService from "../index.js";
import * as US from "./schemas/users.js";
import { SuccessResponse, OrgIdQuery } from "./schemas/common.js";

/**
 * CAMPOS DE USUARIO - MATRIZ DE MODIFICABILIDAD
 *
 * NUNCA MODIFICABLES (sistema):
 * - id: Identificador único inmutable
 * - passwordHash: Solo via endpoint /change-password
 * - createdAt: Timestamp de creación
 *
 * MODIFICABLES CON RESTRICCIONES:
 * - username: Unicidad requerida, no puede duplicarse
 * - email: Unicidad requerida, no puede duplicarse
 * - isActive: Solo admin global (org admin no puede cambiar)
 * - roleIds: Solo roles del contexto del caller
 * - groupIds: Solo grupos del contexto del caller (si existen)
 * - permissions: Solo admin global
 *
 * MODIFICABLES SIN RESTRICCIONES:
 * - metadata: Datos personalizados por aplicación
 *
 * orgMemberships:
 * - Org admin: Puede editar roleIds de su propia membresía
 * - Global admin: Acceso irrestricto
 */

/**
 * Verifica que el usuario target pertenezca a la org del caller.
 * Admin global (sin orgId) opera sobre usuarios sin restricción de org.
 * Admin de org (con orgId) solo opera sobre usuarios miembros de su org.
 */
async function assertUserOrgAccess(identity: IdentityManagerService, targetUserId: string, callerOrgId?: string, token?: string): Promise<void> {
	if (!callerOrgId) return; // Admin global: sin restricción de membresía
	const user = await identity.users.getUser(targetUserId, token);
	if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
	const isMember = user.orgMemberships?.some((m) => m.orgId === callerOrgId);
	if (!isMember) throw new IdentityError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este usuario");
}

/**
 * Valida que todos los roleIds sean accesibles para el caller.
 * Admin global: acceso irrestricto a cualquier rol.
 * Admin de org: solo roles de su org.
 */
async function validateRoleIdsContext(identity: IdentityManagerService, roleIds: string[], callerOrgId?: string, token?: string): Promise<void> {
	if (!roleIds?.length) return;
	// Global admin: puede asignar cualquier rol
	if (!callerOrgId) return;
	// Org admin: validación restringida
	for (const rid of roleIds) {
		const role = await identity.roles.getRole(rid, token);
		if (!role) throw new IdentityError(400, "INVALID_ROLE", `Rol ${rid} no encontrado`);

		const isOwnOrg = role.orgId === callerOrgId;
		if (!isOwnOrg) {
			throw new IdentityError(403, "CROSS_ORG_ROLE", `No puedes asignar el rol ${role.name} de otro contexto`);
		}
	}
}

/**
 * Valida campos inmutables/sensibles en actualización de usuario:
 * - username: No puede haber duplicados
 * - email: No puede haber duplicados
 * - isActive: Solo admin puede cambiar (requiere acción específica)
 * - groupIds: Valida acceso similar a roleIds
 * - permissions: Solo admin global puede asignar
 */
async function validateImmutableFields(
	identity: IdentityManagerService,
	currentUser: Awaited<ReturnType<IdentityManagerService["users"]["getUser"]>>,
	updates: Partial<any>,
	callerOrgId?: string
): Promise<void> {
	// Username: validar unicidad si se intenta cambiar
	if (updates.username !== undefined && updates.username !== currentUser?.username) {
		const existing = await identity.users.getUserByUsername(updates.username);
		if (existing && existing.id !== currentUser?.id) {
			throw new AuthError(409, "USERNAME_EXISTS", `El nombre de usuario '${updates.username}' ya está en uso`);
		}
	}

	// Email: validar unicidad si se intenta cambiar
	if (updates.email !== undefined && updates.email !== currentUser?.email) {
		const existing = await identity.users.getUserByEmail(updates.email);
		if (existing && existing.id !== currentUser?.id) {
			throw new AuthError(409, "EMAIL_EXISTS", `El email '${updates.email}' ya está registrado`);
		}
	}

	// isActive: solo admin puede cambiar estado activo/inactivo
	if (updates.isActive !== undefined && updates.isActive !== currentUser?.isActive) {
		// Org admin no puede cambiar isActive, solo admin global
		if (callerOrgId) {
			throw new IdentityError(403, "FORBIDDEN_FIELD", "Solo administrador global puede cambiar el estado del usuario");
		}
		// Se verifica que sea un booleano válido
		if (typeof updates.isActive !== "boolean") {
			throw new IdentityError(400, "INVALID_FIELD", "isActive debe ser un booleano");
		}
	}

	// groupIds: validar acceso similar a roleIds
	if (updates.groupIds?.length) {
		for (const gid of updates.groupIds) {
			// Validar que el grupo existe y es accesible
			const group = await identity.groups?.getGroup?.(gid);
			if (!group) {
				throw new IdentityError(400, "INVALID_GROUP", `Grupo ${gid} no encontrado`);
			}
			// Org admin solo puede asignar grupos de su propia org
			if (callerOrgId && group.orgId && group.orgId !== callerOrgId) {
				throw new IdentityError(403, "CROSS_ORG_GROUP", `No puedes asignar el grupo ${group.name} de otro contexto`);
			}
		}
	}

	// permissions: solo admin global puede asignar permisos directos
	if (updates.permissions?.length) {
		if (callerOrgId) {
			throw new IdentityError(403, "FORBIDDEN_FIELD", "Solo administrador global puede asignar permisos directos");
		}
		// Validar estructura de permisos
		for (const perm of updates.permissions) {
			if (!perm.resource || perm.action === undefined || perm.scope === undefined) {
				throw new IdentityError(400, "INVALID_PERMISSION", "Permisos mal formados: requieren resource, action y scope");
			}
		}
	}
}

function getScopedMembership(user: Awaited<ReturnType<IdentityManagerService["users"]["getUser"]>>, callerOrgId?: string) {
	if (!callerOrgId || !user?.orgMemberships?.length) return undefined;
	return user.orgMemberships.find((membership) => membership.orgId === callerOrgId);
}

function getContextRoleIds(user: NonNullable<Awaited<ReturnType<IdentityManagerService["users"]["getUser"]>>>, callerOrgId?: string): string[] {
	if (!callerOrgId) {
		return [...(user.roleIds || []), ...(user.orgMemberships || []).flatMap((membership) => membership.roleIds || [])];
	}

	const scopedMembership = getScopedMembership(user, callerOrgId);
	return [...(user.roleIds || []), ...(scopedMembership?.roleIds || [])];
}

function sanitizeUserForContext(user: NonNullable<Awaited<ReturnType<IdentityManagerService["users"]["getUser"]>>>, callerOrgId?: string) {
	const { passwordHash, ...safeUser } = user;
	if (!callerOrgId) return safeUser;

	return {
		...safeUser,
		orgMemberships: safeUser.orgMemberships?.filter((membership) => membership.orgId === callerOrgId) || [],
	};
}

/**
 * Endpoints HTTP para gestión de usuarios
 * Registrados automáticamente por @EnableEndpoints en IdentityManagerService
 */
export class UserEndpoints {
	private static identity: IdentityManagerService;
	private static kernelKey: symbol;

	static init(identity: IdentityManagerService, kernelKey: symbol): void {
		UserEndpoints.identity ??= identity;
		UserEndpoints.kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "HEAD",
		url: "/api/identity/users/username/:username",
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Comprueba si un username existe",
			description: "Responde 200 si el usuario existe; 404 si no. No expone datos del usuario.",
			schema: { params: US.UsernameParams },
		},
	})
	static async checkUsername(ctx: EndpointCtx<{ username: string }>) {
		const { username } = ctx.params;

		const exists = await UserEndpoints.identity.users.existUserByName(username);

		if (!exists) {
			throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		}

		return {};
	}

	/**
	 * Endpoint público para resolver avatares de un conjunto de usuarios
	 * (e.g. autores de comentarios, miembros listados, etc.). Devuelve únicamente
	 * username + avatar — datos ya públicos donde se muestren.
	 */
	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/avatars",
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Resuelve avatares públicos por IDs",
			description: "Devuelve `username` + `avatar` (datos públicos) para los IDs indicados en `ids` (separados por coma).",
			rateLimit: { max: 60, timeWindow: 60_000 },
			schema: { querystring: US.AvatarsQuery, response: { 200: US.PublicAvatarsResponse } },
		},
	})
	static async getAvatars(ctx: EndpointCtx) {
		const idsParam = (ctx.query?.ids ?? "").toString().trim();
		if (!idsParam) return { profiles: {} };
		const ids = idsParam
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const profiles = await UserEndpoints.identity.users.getPublicProfiles(ids);
		const out: Record<string, { username?: string; avatar: string | null }> = {};
		for (const [id, p] of profiles) out[id] = p;
		return { profiles: out };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users",
		permissions: [P.IDENTITY.USERS.READ],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Lista usuarios",
			description: "Lista usuarios del contexto. El admin global puede filtrar por `orgId`; el admin de org usa su propia organización.",
			schema: { querystring: US.ListUsersQuery, response: { 200: US.UsersListResponse } },
		},
	})
	static async listUsers(ctx: EndpointCtx) {
		// Org admin usa orgId del token; global admin puede filtrar por query param
		const orgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		const users = await UserEndpoints.identity.users.getAllUsers(ctx.token!, orgId);

		// Recoger todos los roleIds referenciados por los usuarios (incluidos orgMemberships)
		const roleIdSet = new Set<string>();
		for (const user of users) {
			for (const roleId of getContextRoleIds(user, orgId)) {
				roleIdSet.add(roleId);
			}
		}

		const roles = await UserEndpoints.identity.roles.getRolesByIds([...roleIdSet], ctx.token!, orgId);

		return {
			users: users.map((user) => sanitizeUserForContext(user, orgId)),
			roles,
		};
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/search",
		permissions: [P.IDENTITY.USERS.READ],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Busca usuarios",
			description: "Búsqueda por texto (`q`, mín. 2 caracteres). Devuelve hasta 10 resultados.",
			schema: { querystring: US.SearchUsersQuery, response: { 200: US.UsersArrayResponse } },
		},
	})
	static async searchUsers(ctx: EndpointCtx) {
		const q = ctx.query?.q?.trim();
		if (!q || q.length < 2) return [];
		const orgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		const users = await UserEndpoints.identity.users.searchUsers(q, 10, ctx.token!, orgId);

		return users.map((user) => sanitizeUserForContext(user, orgId));
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/me",
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Usuario autenticado actual",
			description: "Devuelve el perfil del usuario autenticado (sin `passwordHash`).",
			schema: { response: { 200: US.UserResponse } },
		},
	})
	static async getCurrentUser(ctx: EndpointCtx) {
		if (!ctx.user) {
			throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		}

		const user = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) {
			throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		}

		return sanitizeUserForContext(user, ctx.user.orgId);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/me/preferences",
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Preferencias del usuario actual",
			schema: { response: { 200: US.PreferencesResponse } },
		},
	})
	static async getMyPreferences(ctx: EndpointCtx) {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		const user = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		const preferences = (user.metadata?.preferences as Record<string, unknown>) ?? {};
		return { preferences };
	}

	@RegisterEndpoint({
		method: "PATCH",
		url: "/api/identity/users/me/preferences",
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Actualiza preferencias del usuario actual",
			description: "Merge superficial de las preferencias enviadas con las existentes.",
			schema: { body: US.PreferencesBody, response: { 200: US.PreferencesResponse } },
		},
	})
	static async patchMyPreferences(ctx: EndpointCtx<Record<string, string>, Record<string, unknown>>) {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		const patch = ctx.data ?? {};
		if (typeof patch !== "object" || Array.isArray(patch)) {
			throw new IdentityError(400, "INVALID_BODY", "El body debe ser un objeto plano");
		}
		const user = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		const currentPrefs = (user.metadata?.preferences as Record<string, unknown>) ?? {};
		const nextPrefs = { ...currentPrefs, ...patch };
		const updated = await UserEndpoints.identity.users.updateOwnMetadata(ctx.user.id, { preferences: nextPrefs }, ctx.token!);
		return { preferences: (updated.metadata?.preferences as Record<string, unknown>) ?? {} };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/:userId",
		permissions: [P.IDENTITY.USERS.READ],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Obtiene un usuario por ID",
			schema: { params: US.UserIdParams, response: { 200: US.UserResponse } },
		},
	})
	static async getUser(ctx: EndpointCtx<{ userId: string }>) {
		const callerOrgId = ctx.user?.orgId;
		await assertUserOrgAccess(UserEndpoints.identity, ctx.params.userId, callerOrgId, ctx.token!);
		const user = await UserEndpoints.identity.users.getUser(ctx.params.userId, ctx.token!);
		if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		return sanitizeUserForContext(user, callerOrgId);
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/change-password",
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Cambia la contraseña propia",
			description: "Verifica `currentPassword` y establece `newPassword` (mín. 8 caracteres).",
			rateLimit: { max: 3, timeWindow: 300_000 },
			schema: { body: US.ChangePasswordBody, response: { 200: SuccessResponse } },
		},
	})
	static async changePassword(ctx: EndpointCtx<Record<string, string>, { currentPassword: string; newPassword: string }>) {
		if (!ctx.user) {
			throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		}

		const { currentPassword, newPassword } = ctx.data || {};

		if (!currentPassword || !newPassword) {
			throw new IdentityError(400, "MISSING_FIELDS", "Faltan campos");
		}

		if (newPassword.length < 8) {
			throw new AuthError(400, "WEAK_PASSWORD", "La nueva contraseña debe tener al menos 8 caracteres");
		}

		const user = await UserEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) {
			throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		}

		// Primitiva pre-auth: vía la superficie privilegiada `_internal(kernelKey)`,
		// no por el getter público `users` (que ya no la expone).
		const isValid = await UserEndpoints.identity
			._internal(UserEndpoints.kernelKey)
			.users.verifyUserPassword(user.id, currentPassword);

		if (!isValid) {
			throw new AuthError(401, "INVALID_PASSWORD", "Contraseña actual incorrecta");
		}

		await UserEndpoints.identity.users.updatePassword(user.id, newPassword, ctx.token!);
		// Aviso de seguridad (fire-and-forget).
		void UserEndpoints.identity.notifications(UserEndpoints.kernelKey).passwordChanged(user.id);

		return { success: true };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users",
		permissions: [P.IDENTITY.USERS.WRITE],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Crea un usuario",
			description: "El admin de org lo asocia automáticamente a su organización; el admin global puede indicar `orgId`.",
			schema: { body: US.CreateUserBody, response: { 200: US.UserResponse } },
		},
	})
	static async createUser(
		ctx: EndpointCtx<Record<string, string>, { username: string; password: string; roleIds?: string[]; orgId?: string }>
	) {
		if (!ctx.data?.username || !ctx.data?.password) {
			throw new IdentityError(400, "MISSING_FIELDS", "username y password son requeridos");
		}
		// Org admin usa orgId del token; global admin puede especificar en body
		const callerOrgId = ctx.user?.orgId || ctx.data?.orgId;
		// Validar que los roleIds asignados sean del contexto correcto
		if (ctx.data.roleIds?.length) {
			await validateRoleIdsContext(UserEndpoints.identity, ctx.data.roleIds, callerOrgId, ctx.token!);
		}
		const globalRoleIds = callerOrgId ? [] : ctx.data.roleIds;
		const user = await UserEndpoints.identity.users.createUser(ctx.data.username, ctx.data.password, globalRoleIds, ctx.token!);
		// Si se crea desde modo org, asociar automáticamente a la organización
		if (callerOrgId) {
			await UserEndpoints.identity.users.addOrgMembership(user.id, callerOrgId, ctx.data.roleIds || [], ctx.token!);
		}
		const createdUser = callerOrgId ? await UserEndpoints.identity.users.getUser(user.id, ctx.token!) : user;
		if (!createdUser) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		UserEndpoints.identity.permissions.invalidateUser(createdUser.id);
		return sanitizeUserForContext(createdUser, callerOrgId);
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/identity/users/:userId",
		permissions: [P.IDENTITY.USERS.UPDATE],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Actualiza un usuario",
			description: "Campos sensibles (isActive, permissions) restringidos a admin global. `passwordHash`/`id` se ignoran.",
			schema: { params: US.UserIdParams, querystring: OrgIdQuery, body: US.UpdateUserBody, response: { 200: US.UserResponse } },
		},
	})
	static async updateUser(
		ctx: EndpointCtx<
			{ userId: string },
			Partial<{
				username: string;
				email: string;
				isActive: boolean;
				roleIds: string[];
				groupIds: string[];
				permissions: { resource: string; action: number; scope: number }[];
			}>
		>
	) {
		const callerOrgId = ctx.user?.orgId || ctx.query?.orgId || undefined;

		await assertUserOrgAccess(UserEndpoints.identity, ctx.params.userId, callerOrgId, ctx.token!);

		// Obtener usuario actual para validaciones comparativas
		const currentUser = await UserEndpoints.identity.users.getUser(ctx.params.userId, ctx.token!);
		if (!currentUser) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");

		const updates = { ...ctx.data };

		// Validar campos inmutables/sensibles ANTES de cualquier modificación
		await validateImmutableFields(UserEndpoints.identity, currentUser, updates, callerOrgId);

		// Prevent updating sensitive fields via API
		delete (updates as any).passwordHash;
		delete (updates as any).id;

		// Validar que los roleIds asignados sean del contexto correcto
		if (updates.roleIds?.length) {
			await validateRoleIdsContext(UserEndpoints.identity, updates.roleIds, callerOrgId, ctx.token!);
		}

		if (callerOrgId) {
			const scopedMembership = getScopedMembership(currentUser, callerOrgId);
			if (!scopedMembership) {
				throw new IdentityError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este usuario");
			}

			// En contexto org: solo permitir actualizar roleIds dentro de la membresía
			const nextMemberships = (currentUser.orgMemberships || []).map((membership) =>
				membership.orgId === callerOrgId ? { ...membership, roleIds: updates.roleIds || membership.roleIds } : membership
			);

			// Remover roleIds y groupIds del objeto updates ya que se manejan via orgMemberships
			const safeUpdates = { ...updates };
			delete (safeUpdates as any).roleIds;
			delete (safeUpdates as any).groupIds;

			const user = await UserEndpoints.identity.users.updateUser(
				ctx.params.userId,
				{ ...safeUpdates, orgMemberships: nextMemberships },
				ctx.token!
			);
			UserEndpoints.identity.permissions.invalidateUser(user.id);
			return sanitizeUserForContext(user, callerOrgId);
		}

		// Global admin: permitir todas las actualizaciones validadas
		const user = await UserEndpoints.identity.users.updateUser(ctx.params.userId, updates, ctx.token!);
		UserEndpoints.identity.permissions.invalidateUser(user.id);
		return sanitizeUserForContext(user);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/users/:userId",
		permissions: [P.IDENTITY.USERS.DELETE],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Elimina un usuario",
			description: "En modo org, solo quita la membresía de la organización; el admin global elimina el usuario.",
			schema: { params: US.UserIdParams, querystring: OrgIdQuery, response: { 200: SuccessResponse } },
		},
	})
	static async deleteUser(ctx: EndpointCtx<{ userId: string }>) {
		const callerOrgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		await assertUserOrgAccess(UserEndpoints.identity, ctx.params.userId, callerOrgId, ctx.token!);
		if (callerOrgId) {
			await UserEndpoints.identity.users.removeOrgMembership(ctx.params.userId, callerOrgId, ctx.token!);
			UserEndpoints.identity.permissions.invalidateUser(ctx.params.userId);
			return { success: true };
		}
		await UserEndpoints.identity.users.deleteUser(ctx.params.userId, ctx.token!);
		UserEndpoints.identity.permissions.invalidateUser(ctx.params.userId);
		return { success: true };
	}

	// ────────────────────────────────────────────────────────────────────────
	// Self-delete
	// ────────────────────────────────────────────────────────────────────────

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/users/me",
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Solicita la baja de la cuenta propia",
			description: "Programa el borrado de la cuenta en 30 días. Acepta un `reason` opcional.",
			schema: { body: US.DeleteSelfBody, response: { 200: US.DeleteSelfResponse } },
		},
	})
	static async deleteSelf(ctx: EndpointCtx<Record<string, string>, { reason?: string }>) {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay sesión");
		const { reason } = ctx.data || {};
		await UserEndpoints.identity.users.requestSelfDeletion(ctx.user.id, reason, 30, ctx.token!);
		return { success: true, scheduledDeletionInDays: 30 };
	}

	// ────────────────────────────────────────────────────────────────────────
	// Bug bounty — upgrade temporal de tier (recompensa)
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Otorga un upgrade temporal de tier a un usuario (recompensa de bug bounty).
	 * Solo admin/Security Manager (permiso UPDATE sobre usuarios). El cron de
	 * IdentityManagerService revierte el grant al expirar.
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/:userId/tier-grant",
		permissions: [P.IDENTITY.USERS.UPDATE],
		options: {
			tag: "IdentityManagerService/Users",
			summary: "Otorga un upgrade temporal de tier (bug bounty)",
			description: "Setea un tier de pago (plus/pro) por N días; un cron lo revierte al expirar. Solo admin/Security Manager.",
			schema: { params: US.UserIdParams, body: US.TierGrantBody, response: { 200: US.TierGrantResponse } },
		},
	})
	static async grantTier(ctx: EndpointCtx<{ userId: string }, { tier: "pro" | "plus"; days: number; reason?: string }>) {
		const { tier, days, reason } = ctx.data || ({} as { tier: "pro" | "plus"; days: number; reason?: string });
		const grant = await UserEndpoints.identity.users.grantTemporaryTier(ctx.params.userId, tier, days, reason, ctx.token!);
		UserEndpoints.identity.permissions.invalidateUser(ctx.params.userId);
		return grant;
	}
}
