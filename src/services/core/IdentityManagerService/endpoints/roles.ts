import { RegisterEndpoint, type EndpointCtx } from "../../EndpointManagerService/index.js";
import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { P } from "@common/types/Permissions.ts";
import type IdentityManagerService from "../index.js";

/**
 * Verifica que un rol sea custom y accesible para el caller.
 * Admin global (sin orgId) puede operar en roles de cualquier org.
 * Admin de org (con orgId) solo puede operar en roles de su org.
 */
async function assertRoleOrgAccess(identity: IdentityManagerService, roleId: string, callerOrgId?: string, token?: string): Promise<void> {
	const role = await identity.roles.getRole(roleId, token);
	if (!role) throw new IdentityError(404, "ROLE_NOT_FOUND", "Rol no encontrado");
	if (!role.isCustom) throw new IdentityError(403, "CANNOT_MODIFY_PREDEFINED", "No se pueden modificar roles predefinidos");

	// Org admin: restringido a su propia org
	if (callerOrgId && role.orgId !== callerOrgId) {
		throw new IdentityError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este rol");
	}
	// Global admin (sin callerOrgId): acceso irrestricto a roles de cualquier org
}

/**
 * Endpoints HTTP para gestión de roles
 */
export class RoleEndpoints {
	private static identity: IdentityManagerService;

	static init(identity: IdentityManagerService): void {
		RoleEndpoints.identity ??= identity;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/roles",
		permissions: [P.IDENTITY.ROLES.READ],
	})
	static async listRoles(ctx: EndpointCtx) {
		// Org admin usa orgId del token; global admin puede filtrar por query param
		const orgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		if (orgId) {
			await RoleEndpoints.identity.roles.initializePredefinedRoles(orgId);
		}
		return RoleEndpoints.identity.roles.getAllRoles(ctx.token!, orgId);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/roles/:roleId",
		permissions: [P.IDENTITY.ROLES.READ],
	})
	static async getRole(ctx: EndpointCtx<{ roleId: string }>) {
		const role = await RoleEndpoints.identity.roles.getRole(ctx.params.roleId, ctx.token!);
		if (!role) throw new IdentityError(404, "ROLE_NOT_FOUND", "Rol no encontrado");
		// En modo org: solo ver roles predefinidos o de tu org
		const callerOrgId = ctx.user?.orgId;
		if (callerOrgId && role.isCustom && role.orgId !== callerOrgId) {
			throw new IdentityError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este rol");
		}
		return role;
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/roles",
		permissions: [P.IDENTITY.ROLES.WRITE],
	})
	static async createRole(
		ctx: EndpointCtx<Record<string, string>, { name: string; description: string; permissions?: any[]; orgId?: string }>
	) {
		if (!ctx.data?.name) {
			throw new IdentityError(400, "MISSING_FIELDS", "name es requerido");
		}
		// Org admin usa orgId del token; global admin puede especificar en body
		const orgId = ctx.user?.orgId || ctx.data?.orgId;
		const role = await RoleEndpoints.identity.roles.createRole(
			ctx.data.name,
			ctx.data.description || "",
			ctx.data.permissions,
			ctx.token!,
			orgId
		);
		RoleEndpoints.identity.permissions.invalidateRole(role.id);
		return role;
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/identity/roles/:roleId",
		permissions: [P.IDENTITY.ROLES.UPDATE],
	})
	static async updateRole(ctx: EndpointCtx<{ roleId: string }, Partial<{ name: string; description: string; permissions: any[] }>>) {
		await assertRoleOrgAccess(RoleEndpoints.identity, ctx.params.roleId, ctx.user?.orgId, ctx.token!);
		const role = await RoleEndpoints.identity.roles.updateRole(ctx.params.roleId, ctx.data || {}, ctx.token!);
		RoleEndpoints.identity.permissions.invalidateRole(ctx.params.roleId);
		return role;
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/roles/:roleId",
		permissions: [P.IDENTITY.ROLES.DELETE],
		options: { enqueue: true, queueOptions: { maxRetries: 3, jobTimeoutMs: 20_000 } },
	})
	static async deleteRole(ctx: EndpointCtx<{ roleId: string }>) {
		try {
			await assertRoleOrgAccess(RoleEndpoints.identity, ctx.params.roleId, ctx.user?.orgId, ctx.token!);
			const resumeFromStep = (ctx as any)._stepperResumeIdx as number | undefined;
			await RoleEndpoints.identity.roles.deleteRole(ctx.params.roleId, ctx.token!, resumeFromStep);
			RoleEndpoints.identity.permissions.invalidateRole(ctx.params.roleId);
			return { success: true };
		} catch (error: any) {
			if (error.message?.includes("no encontrado")) {
				throw new IdentityError(404, "ROLE_NOT_FOUND", error.message);
			}
			if (error.message?.includes("predefinidos")) {
				throw new IdentityError(403, "CANNOT_DELETE_PREDEFINED", error.message);
			}
			throw error;
		}
	}
}
