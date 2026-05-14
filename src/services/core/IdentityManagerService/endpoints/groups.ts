import { RegisterEndpoint, type EndpointCtx } from "../../EndpointManagerService/index.js";
import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { P } from "@common/types/Permissions.ts";
import { IdentityScopes } from "@common/types/identity/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.ts";
import type IdentityManagerService from "../index.js";

/**
 * Verifica que un grupo sea accesible para el caller.
 * Admin global (sin orgId) puede operar en grupos de cualquier org.
 * Admin de org (con orgId) solo opera en grupos de su org.
 */
async function assertGroupOrgAccess(identity: IdentityManagerService, groupId: string, callerOrgId?: string, token?: string): Promise<void> {
	const group = await identity.groups.getGroup(groupId, token);
	if (!group) throw new IdentityError(404, "GROUP_NOT_FOUND", "Grupo no encontrado");

	// Org admin: restringido a su propia org
	if (callerOrgId && group.orgId !== callerOrgId) {
		throw new IdentityError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este grupo");
	}
	// Global admin (sin callerOrgId): acceso irrestricto
}

// Verifica que un usuario pertenezca a la org del caller
async function assertUserInOrg(identity: IdentityManagerService, userId: string, callerOrgId?: string, token?: string): Promise<void> {
	if (!callerOrgId) return;
	const user = await identity.users.getUser(userId, token);
	if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
	const isMember = user.orgMemberships?.some((m) => m.orgId === callerOrgId);
	if (!isMember) throw new IdentityError(403, "CROSS_ORG_USER", "El usuario no pertenece a tu organización");
}

async function validateRoleIdsContext(identity: IdentityManagerService, roleIds: string[], callerOrgId?: string, token?: string): Promise<void> {
	if (!roleIds?.length) return;
	if (!callerOrgId) return;

	for (const rid of roleIds) {
		const role = await identity.roles.getRole(rid, token);
		if (!role) throw new IdentityError(400, "INVALID_ROLE", `Rol ${rid} no encontrado`);

		const isOwnOrg = role.orgId === callerOrgId;
		if (!isOwnOrg) {
			throw new IdentityError(403, "CROSS_ORG_ROLE", `No puedes asignar el rol ${role.name} de otro contexto`);
		}
	}
}

// Endpoints HTTP para gestión de grupos
export class GroupEndpoints {
	private static identity: IdentityManagerService;

	static init(identity: IdentityManagerService): void {
		GroupEndpoints.identity ??= identity;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/groups",
		permissions: [P.IDENTITY.GROUPS.READ],
	})
	static async listGroups(ctx: EndpointCtx) {
		// Org admin usa orgId del token; global admin puede filtrar por query param
		const orgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		return GroupEndpoints.identity.groups.getAllGroups(ctx.token!, orgId);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/groups/search",
		permissions: [P.IDENTITY.GROUPS.READ],
	})
	static async searchGroups(ctx: EndpointCtx) {
		const q = ctx.query?.q?.trim();
		if (!q || q.length < 2) return [];
		const orgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		const groups = await GroupEndpoints.identity.groups.searchGroups(q, 10, ctx.token!, orgId);
		return groups;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/groups/:groupId",
		permissions: [P.IDENTITY.GROUPS.READ],
	})
	static async getGroup(ctx: EndpointCtx<{ groupId: string }>) {
		const group = await GroupEndpoints.identity.groups.getGroup(ctx.params.groupId, ctx.token!);
		if (!group) throw new IdentityError(404, "GROUP_NOT_FOUND", "Grupo no encontrado");
		const callerOrgId = ctx.user?.orgId;
		if (callerOrgId && group.orgId !== callerOrgId) {
			throw new IdentityError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este grupo");
		}
		return group;
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/groups",
		permissions: [P.IDENTITY.GROUPS.WRITE],
	})
	static async createGroup(
		ctx: EndpointCtx<Record<string, string>, { name: string; description: string; roleIds?: string[]; orgId?: string }>
	) {
		if (!ctx.data?.name) {
			throw new IdentityError(400, "MISSING_FIELDS", "name es requerido");
		}
		// Org admin usa orgId del token; global admin puede especificar en body
		const orgId = ctx.user?.orgId || ctx.data?.orgId;
		if (ctx.data.roleIds?.length) {
			await validateRoleIdsContext(GroupEndpoints.identity, ctx.data.roleIds, orgId, ctx.token!);
		}
		const group = await GroupEndpoints.identity.groups.createGroup(
			ctx.data.name,
			ctx.data.description || "",
			ctx.data.roleIds,
			ctx.token!,
			orgId
		);
		GroupEndpoints.identity.permissions.invalidateGroup(group.id);
		return group;
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/identity/groups/:groupId",
		permissions: [P.IDENTITY.GROUPS.UPDATE],
	})
	static async updateGroup(
		ctx: EndpointCtx<
			{ groupId: string },
			Partial<{ name: string; description: string; roleIds: string[]; permissions: { resource: string; action: number; scope: number }[] }>
		>
	) {
		const callerOrgId = ctx.user?.orgId;
		await assertGroupOrgAccess(GroupEndpoints.identity, ctx.params.groupId, callerOrgId, ctx.token!);
		if (ctx.data?.roleIds?.length) {
			await validateRoleIdsContext(GroupEndpoints.identity, ctx.data.roleIds, callerOrgId, ctx.token!);
		}
		const group = await GroupEndpoints.identity.groups.updateGroup(ctx.params.groupId, ctx.data || {}, ctx.token!);
		GroupEndpoints.identity.permissions.invalidateGroup(ctx.params.groupId);
		return group;
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/groups/:groupId",
		permissions: [P.IDENTITY.GROUPS.DELETE],
	})
	static async deleteGroup(ctx: EndpointCtx<{ groupId: string }>) {
		await assertGroupOrgAccess(GroupEndpoints.identity, ctx.params.groupId, ctx.user?.orgId, ctx.token!);
		await GroupEndpoints.identity.groups.deleteGroup(ctx.params.groupId, ctx.token!);
		GroupEndpoints.identity.permissions.invalidateGroup(ctx.params.groupId);
		return { success: true };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/groups/:groupId/users",
		permissions: [P.IDENTITY.GROUPS.READ],
	})
	static async listGroupMembers(ctx: EndpointCtx<{ groupId: string }>) {
		await assertGroupOrgAccess(GroupEndpoints.identity, ctx.params.groupId, ctx.user?.orgId, ctx.token!);
		return GroupEndpoints.identity.groups.getGroupUsers(ctx.params.groupId, ctx.token!);
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/groups/:groupId/users/:userId",
		permissions: [`identity.${IdentityScopes.GROUPS | IdentityScopes.USERS}.${CRUDXAction.WRITE}`],
	})
	static async addUserToGroup(ctx: EndpointCtx<{ groupId: string; userId: string }>) {
		const callerOrgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		await assertGroupOrgAccess(GroupEndpoints.identity, ctx.params.groupId, callerOrgId, ctx.token!);
		await assertUserInOrg(GroupEndpoints.identity, ctx.params.userId, callerOrgId, ctx.token!);
		await GroupEndpoints.identity.groups.addUserToGroup(ctx.params.userId, ctx.params.groupId, ctx.token!);
		GroupEndpoints.identity.permissions.invalidateUser(ctx.params.userId);
		return { success: true };
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/groups/:groupId/users/:userId",
		permissions: [`identity.${IdentityScopes.GROUPS | IdentityScopes.USERS}.${CRUDXAction.DELETE}`],
	})
	static async removeUserFromGroup(ctx: EndpointCtx<{ groupId: string; userId: string }>) {
		const callerOrgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		await assertGroupOrgAccess(GroupEndpoints.identity, ctx.params.groupId, callerOrgId, ctx.token!);
		await assertUserInOrg(GroupEndpoints.identity, ctx.params.userId, callerOrgId, ctx.token!);
		await GroupEndpoints.identity.groups.removeUserFromGroup(ctx.params.userId, ctx.params.groupId, ctx.token!);
		GroupEndpoints.identity.permissions.invalidateUser(ctx.params.userId);
		return { success: true };
	}
}
