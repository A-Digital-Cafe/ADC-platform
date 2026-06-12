import { RegisterEndpoint, type EndpointCtx } from "../../EndpointManagerService/index.js";
import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { P } from "@common/types/Permissions.ts";
import type IdentityManagerService from "../index.js";
import * as OS from "./schemas/organizations.js";
import { SuccessResponse, JobAcceptedResponse } from "./schemas/common.js";

import type { Organization } from "@common/types/identity/Organization.js";

/** Org/region management is global-only. Users in org mode cannot manage these. */
function requireGlobalAccess(ctx: EndpointCtx): void {
	if (ctx.user?.orgId) {
		throw new IdentityError(403, "GLOBAL_ONLY", "La gestión de organizaciones requiere acceso global (modo personal)");
	}
}

function assertReadableOrganizationAccess(ctx: EndpointCtx, orgId: string): void {
	if (ctx.user?.orgId && ctx.user.orgId !== orgId) {
		throw new IdentityError(403, "ORG_ACCESS_DENIED", "No tienes acceso a esta organización");
	}
}

/**
 * Endpoints HTTP para gestión de organizaciones
 */
export class OrgEndpoints {
	private static identity: IdentityManagerService;

	static init(identity: IdentityManagerService): void {
		OrgEndpoints.identity ??= identity;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/organizations",
		permissions: [P.IDENTITY.ORGANIZATIONS.READ],
		options: {
			tag: "IdentityManagerService/Organizations",
			summary: "Lista organizaciones",
			description: "Solo accesible en modo global (admin sin organización activa).",
			schema: { response: { 200: OS.OrganizationsListResponse } },
		},
	})
	static async listOrganizations(ctx: EndpointCtx) {
		requireGlobalAccess(ctx);
		return OrgEndpoints.identity.organizations.getAllOrganizations(ctx.token!);
	}

	/**
	 * Comprueba disponibilidad de un slug de organización.
	 * Se declara antes de `:orgId` para que matchee como ruta específica.
	 * `default` está reservado para contexto global.
	 */
	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/organizations/check-slug/:slug",
		permissions: [P.IDENTITY.ORGANIZATIONS.READ],
		options: {
			tag: "IdentityManagerService/Organizations",
			summary: "Comprueba disponibilidad de un slug",
			description: "`default` está reservado. El slug debe cumplir `^[a-z0-9-]+$`.",
			schema: { params: OS.OrgSlugParams, response: { 200: OS.CheckSlugResponse } },
		},
	})
	static async checkOrgSlug(ctx: EndpointCtx<{ slug: string }>) {
		requireGlobalAccess(ctx);
		const normalized = ctx.params.slug.toLowerCase().trim();
		if (normalized === "default" || !/^[a-z0-9-]+$/.test(normalized)) {
			return { available: false, reserved: normalized === "default" };
		}
		const existing = await OrgEndpoints.identity.organizations.getOrganization(normalized, ctx.token!);
		return { available: !existing };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/organizations/:orgId",
		permissions: [P.IDENTITY.ORGANIZATIONS.READ],
		options: {
			tag: "IdentityManagerService/Organizations",
			summary: "Obtiene una organización por ID",
			schema: { params: OS.OrgIdParams, response: { 200: OS.OrganizationResponse } },
		},
	})
	static async getOrganization(ctx: EndpointCtx<{ orgId: string }>) {
		const org = await OrgEndpoints.identity.organizations.getOrganization(ctx.params.orgId, ctx.token!);
		if (!org) throw new IdentityError(404, "ORG_NOT_FOUND", "Organización no encontrada");
		assertReadableOrganizationAccess(ctx, org.orgId);
		return org;
	}
	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/organizations/:orgId/slug",
		options: {
			tag: "IdentityManagerService/Organizations",
			summary: "Resuelve el slug de una organización",
			schema: { params: OS.OrgIdParams, response: { 200: OS.OrgSlugResponse } },
		},
	})
	static async getOrganizationSlug(ctx: EndpointCtx<{ orgId: string }>) {
		const result = await OrgEndpoints.identity.organizations.resolveOrganizationSlug(ctx.params.orgId, ctx.token!);
		if (!result) throw new IdentityError(404, "ORG_NOT_FOUND", "Organización no encontrada");
		return result;
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/organizations",
		permissions: [P.IDENTITY.ORGANIZATIONS.WRITE],
		options: {
			tag: "IdentityManagerService/Organizations",
			summary: "Crea una organización",
			description: "Operación **encolada** (202): también inicializa los roles predefinidos. Consultar estado vía `pollUrl`.",
			enqueue: true,
			queueOptions: { maxRetries: 3 },
			schema: { body: OS.CreateOrgBody, response: { 202: JobAcceptedResponse } },
		},
	})
	static async createOrganization(
		ctx: EndpointCtx<Record<string, string>, { slug: string; region?: string; metadata?: Record<string, any> }>
	) {
		requireGlobalAccess(ctx);
		if (!ctx.data?.slug) {
			throw new IdentityError(400, "MISSING_FIELDS", "slug es requerido");
		}
		const org = await OrgEndpoints.identity.organizations.createOrganization(ctx.data.slug, ctx.data.region, ctx.data.metadata, ctx.token!);

		// Auto-crear roles predefinidos para la nueva organización
		await OrgEndpoints.identity.roles.initializePredefinedRoles(org.orgId);
		OrgEndpoints.identity.permissions.invalidateAll();

		return org;
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/identity/organizations/:orgId",
		permissions: [P.IDENTITY.ORGANIZATIONS.UPDATE],
		options: {
			tag: "IdentityManagerService/Organizations",
			summary: "Actualiza una organización",
			schema: { params: OS.OrgIdParams, body: OS.UpdateOrgBody, response: { 200: OS.OrganizationResponse } },
		},
	})
	static async updateOrganization(
		ctx: EndpointCtx<{ orgId: string }, Partial<Pick<Organization, "slug" | "region" | "status" | "metadata">>>
	) {
		requireGlobalAccess(ctx);
		const org = await OrgEndpoints.identity.organizations.updateOrganization(ctx.params.orgId, ctx.data || {}, ctx.token!);
		OrgEndpoints.identity.permissions.invalidateAll();
		return org;
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/organizations/:orgId",
		permissions: [P.IDENTITY.ORGANIZATIONS.DELETE],
		options: {
			tag: "IdentityManagerService/Organizations",
			summary: "Elimina una organización",
			description: "Operación **encolada** (202) con reanudación por pasos. Consultar estado vía `pollUrl`.",
			enqueue: true,
			queueOptions: { maxRetries: 4, jobTimeoutMs: 30_000 },
			schema: { params: OS.OrgIdParams, response: { 202: JobAcceptedResponse } },
		},
	})
	static async deleteOrganization(ctx: EndpointCtx<{ orgId: string }>) {
		requireGlobalAccess(ctx);
		const resumeFromStep = (ctx as any)._stepperResumeIdx as number | undefined;
		await OrgEndpoints.identity.organizations.deleteOrganization(ctx.params.orgId, ctx.token!, resumeFromStep);
		OrgEndpoints.identity.permissions.invalidateAll();
		return { success: true };
	}

	// ── Miembros de organización ──────────────────────────────────────────────

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/organizations/:orgId/members",
		permissions: [P.IDENTITY.ORGANIZATIONS.READ],
		options: {
			tag: "IdentityManagerService/Organizations",
			summary: "Lista miembros de una organización",
			schema: { params: OS.OrgIdParams, response: { 200: OS.OrgMembersResponse } },
		},
	})
	static async listOrgMembers(ctx: EndpointCtx<{ orgId: string }>) {
		const org = await OrgEndpoints.identity.organizations.getOrganization(ctx.params.orgId, ctx.token!);
		if (!org) throw new IdentityError(404, "ORG_NOT_FOUND", "Organización no encontrada");
		assertReadableOrganizationAccess(ctx, org.orgId);

		const members = await OrgEndpoints.identity.users.getAllUsers(ctx.token!, ctx.params.orgId);
		return members.map(({ passwordHash, ...user }) => ({
			...user,
			orgMemberships: user.orgMemberships?.filter((membership) => membership.orgId === org.orgId) || [],
		}));
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/organizations/:orgId/members/:userId",
		permissions: [P.IDENTITY.ORGANIZATIONS.UPDATE],
		options: {
			tag: "IdentityManagerService/Organizations",
			summary: "Añade un miembro a una organización",
			schema: { params: OS.OrgMemberParams, body: OS.AddOrgMemberBody, response: { 200: SuccessResponse } },
		},
	})
	static async addOrgMember(ctx: EndpointCtx<{ orgId: string; userId: string }, { roleIds?: string[] }>) {
		requireGlobalAccess(ctx);
		const org = await OrgEndpoints.identity.organizations.getOrganization(ctx.params.orgId, ctx.token!);
		if (!org) throw new IdentityError(404, "ORG_NOT_FOUND", "Organización no encontrada");

		await OrgEndpoints.identity.users.addOrgMembership(ctx.params.userId, ctx.params.orgId, ctx.data?.roleIds || [], ctx.token!);
		OrgEndpoints.identity.permissions.invalidateUser(ctx.params.userId);
		return { success: true };
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/organizations/:orgId/members/:userId",
		permissions: [P.IDENTITY.ORGANIZATIONS.DELETE],
		options: {
			tag: "IdentityManagerService/Organizations",
			summary: "Quita un miembro de una organización",
			schema: { params: OS.OrgMemberParams, response: { 200: SuccessResponse } },
		},
	})
	static async removeOrgMember(ctx: EndpointCtx<{ orgId: string; userId: string }>) {
		requireGlobalAccess(ctx);
		await OrgEndpoints.identity.users.removeOrgMembership(ctx.params.userId, ctx.params.orgId, ctx.token!);
		OrgEndpoints.identity.permissions.invalidateUser(ctx.params.userId);
		return { success: true };
	}
}
