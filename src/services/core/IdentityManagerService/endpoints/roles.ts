import { RegisterEndpoint, type EndpointCtx } from "../../EndpointManagerService/index.js";
import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { P } from "@common/types/Permissions.ts";
import type IdentityManagerService from "../index.js";
import type { Capability } from "@common/security/Capability.ts";
import type { Role } from "@common/types/identity/Role.ts";
import * as RS from "./schemas/roles.js";
import { JobAcceptedResponse, OrgIdQuery } from "./schemas/common.js";
import { assertCanManageRole } from "../domain/hierarchy.js";

/**
 * Verifica que un rol sea custom y accesible para el caller. Devuelve el rol.
 * Admin global (sin orgId) puede operar en roles de cualquier org.
 * Admin de org (con orgId) solo puede operar en roles de su org.
 */
async function assertRoleOrgAccess(identity: IdentityManagerService, roleId: string, callerOrgId?: string, token?: string): Promise<Role> {
	const role = await identity.roles.getRole(roleId, token);
	if (!role) throw new IdentityError(404, "ROLE_NOT_FOUND", "Rol no encontrado");
	if (!role.isCustom) throw new IdentityError(403, "CANNOT_MODIFY_PREDEFINED", "No se pueden modificar roles predefinidos");

	// Org admin: restringido a su propia org
	if (callerOrgId && role.orgId !== callerOrgId) {
		throw new IdentityError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este rol");
	}
	// Global admin (sin callerOrgId): acceso irrestricto a roles de cualquier org
	return role;
}

/**
 * Endpoints HTTP para gestión de roles
 */
export class RoleEndpoints {
	private static identity: IdentityManagerService;
	private static cap: Capability;

	static init(identity: IdentityManagerService, cap: Capability): void {
		RoleEndpoints.identity ??= identity;
		RoleEndpoints.cap ??= cap;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/roles",
		permissions: [P.IDENTITY.ROLES.READ],
		options: {
			tag: "IdentityManagerService/Roles",
			summary: "Lista roles",
			description: "El admin global puede filtrar por `orgId`; al filtrar por org se inicializan los roles predefinidos.",
			schema: { querystring: OrgIdQuery, response: { 200: RS.RolesListResponse } },
		},
	})
	static async listRoles(ctx: EndpointCtx) {
		// Org admin usa orgId del token; global admin puede filtrar por query param
		const orgId = ctx.user?.orgId || ctx.query?.orgId || undefined;
		if (orgId) {
			const synced = await RoleEndpoints.identity.roles.initializePredefinedRoles(orgId);
			if (synced) RoleEndpoints.identity.permissions.invalidateAll();
		}
		return RoleEndpoints.identity.roles.getAllRoles(ctx.token!, orgId);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/roles/:roleId",
		permissions: [P.IDENTITY.ROLES.READ],
		options: {
			tag: "IdentityManagerService/Roles",
			summary: "Obtiene un rol por ID",
			schema: { params: RS.RoleIdParams, response: { 200: RS.RoleResponse } },
		},
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
		options: {
			tag: "IdentityManagerService/Roles",
			summary: "Crea un rol",
			schema: { body: RS.CreateRoleBody, response: { 200: RS.RoleResponse } },
		},
	})
	static async createRole(
		ctx: EndpointCtx<Record<string, string>, { name: string; description: string; permissions?: any[]; orgId?: string; hierarchy?: number }>
	) {
		if (!ctx.data?.name) {
			throw new IdentityError(400, "MISSING_FIELDS", "name es requerido");
		}
		// Org admin usa orgId del token; global admin puede especificar en body
		const orgId = ctx.user?.orgId || ctx.data?.orgId;
		// Jerarquía: el rol nuevo debe quedar estrictamente por debajo del actor
		const hierarchy = ctx.data.hierarchy ?? 100;
		await assertCanManageRole(RoleEndpoints.identity.permissions, ctx.user?.id, { hierarchy }, ctx.user?.orgId);
		const role = await RoleEndpoints.identity.roles.createRole(
			ctx.data.name,
			ctx.data.description || "",
			ctx.data.permissions,
			ctx.token!,
			orgId,
			hierarchy
		);
		RoleEndpoints.identity.permissions.invalidateRole(role.id);
		return role;
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/identity/roles/:roleId",
		permissions: [P.IDENTITY.ROLES.UPDATE],
		options: {
			tag: "IdentityManagerService/Roles",
			summary: "Actualiza un rol",
			description: "No permite modificar roles predefinidos (`isCustom: false`).",
			schema: { params: RS.RoleIdParams, body: RS.UpdateRoleBody, response: { 200: RS.RoleResponse } },
		},
	})
	static async updateRole(
		ctx: EndpointCtx<{ roleId: string }, Partial<{ name: string; description: string; permissions: any[]; hierarchy: number }>>
	) {
		const current = await assertRoleOrgAccess(RoleEndpoints.identity, ctx.params.roleId, ctx.user?.orgId, ctx.token!);
		// Jerarquía: sólo roles estrictamente por debajo del actor; ídem la nueva jerarquía
		await assertCanManageRole(RoleEndpoints.identity.permissions, ctx.user?.id, current, ctx.user?.orgId, ctx.data?.hierarchy);
		const role = await RoleEndpoints.identity.roles.updateRole(ctx.params.roleId, ctx.data || {}, ctx.token!);
		RoleEndpoints.identity.permissions.invalidateRole(ctx.params.roleId);
		void RoleEndpoints.identity.notifications(RoleEndpoints.cap).securityEvent({
			title: "Rol modificado",
			body: `El rol "${current.name}" fue modificado por ${ctx.user?.id ?? "desconocido"}.`,
			actorId: ctx.user?.id,
			data: { roleId: ctx.params.roleId, orgId: current.orgId ?? null },
		});
		return role;
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/roles/:roleId",
		permissions: [P.IDENTITY.ROLES.DELETE],
		options: {
			tag: "IdentityManagerService/Roles",
			summary: "Elimina un rol",
			description: "Operación **encolada** (202) con reanudación por pasos. No permite eliminar roles predefinidos.",
			enqueue: true,
			queueOptions: { maxRetries: 3, jobTimeoutMs: 20_000 },
			schema: { params: RS.RoleIdParams, response: { 202: JobAcceptedResponse } },
		},
	})
	static async deleteRole(ctx: EndpointCtx<{ roleId: string }>) {
		try {
			const current = await assertRoleOrgAccess(RoleEndpoints.identity, ctx.params.roleId, ctx.user?.orgId, ctx.token!);
			await assertCanManageRole(RoleEndpoints.identity.permissions, ctx.user?.id, current, ctx.user?.orgId);
			const resumeFromStep = (ctx as any)._stepperResumeIdx as number | undefined;
			await RoleEndpoints.identity.roles.deleteRole(ctx.params.roleId, ctx.token!, resumeFromStep);
			RoleEndpoints.identity.permissions.invalidateRole(ctx.params.roleId);
			void RoleEndpoints.identity.notifications(RoleEndpoints.cap).securityEvent({
				title: "Rol eliminado",
				body: `El rol "${current.name}" fue eliminado por ${ctx.user?.id ?? "desconocido"}.`,
				actorId: ctx.user?.id,
				data: { roleId: ctx.params.roleId, orgId: current.orgId ?? null },
			});
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
