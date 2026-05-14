import { RegisterEndpoint, type EndpointCtx } from "../../EndpointManagerService/index.js";
import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { P } from "@common/types/Permissions.ts";
import type IdentityManagerService from "../index.js";

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
		options: { enqueue: true, queueOptions: { maxRetries: 3 } },
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
		options: { enqueue: true, queueOptions: { maxRetries: 4, jobTimeoutMs: 30_000 } },
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
	})
	static async removeOrgMember(ctx: EndpointCtx<{ orgId: string; userId: string }>) {
		requireGlobalAccess(ctx);
		await OrgEndpoints.identity.users.removeOrgMembership(ctx.params.userId, ctx.params.orgId, ctx.token!);
		OrgEndpoints.identity.permissions.invalidateUser(ctx.params.userId);
		return { success: true };
	}
}
