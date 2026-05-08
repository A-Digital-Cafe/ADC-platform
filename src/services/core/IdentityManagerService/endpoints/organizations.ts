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
	static #identity: IdentityManagerService;

	static init(identity: IdentityManagerService): void {
		OrgEndpoints.#identity ??= identity;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/organizations",
		deferAuth: true, // Permitir acceso anónimo, validar manualmente
	})
	static async listOrganizations(ctx: EndpointCtx) {
		// Fallback: si ctx.user no está poblado pero hay token, verificar manualmente
		if (!ctx.user?.id && ctx.token) {
			try {
				const authVerifier = OrgEndpoints.#identity.createAuthVerifier();
				const result = await authVerifier.verifyToken(ctx.token);
				if (result.valid && result.userId) {
					(ctx as any).user = {
						id: result.userId,
						username: "user",
						email: undefined,
						permissions: [],
						orgId: result.orgId,
					};
				}
			} catch {
				// Silent fail - let the subsequent validation handle it
			}
		}

		requireGlobalAccess(ctx);
		return OrgEndpoints.#identity.organizations.getAllOrganizations(ctx.token ?? undefined);
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
		const existing = await OrgEndpoints.#identity.organizations.getOrganization(normalized, ctx.token!);
		return { available: !existing };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/organizations/:orgId",
		deferAuth: true, // Validar acceso manualmente
	})
	static async getOrganization(ctx: EndpointCtx<{ orgId: string }>) {
		// Fallback: si ctx.user no está poblado pero hay token, verificar manualmente
		if (!ctx.user?.id && ctx.token) {
			try {
				const authVerifier = OrgEndpoints.#identity.createAuthVerifier();
				const result = await authVerifier.verifyToken(ctx.token);
				if (result.valid && result.userId) {
					(ctx as any).user = {
						id: result.userId,
						username: "user",
						email: undefined,
						permissions: [],
						orgId: result.orgId,
					};
				}
			} catch {
				// Silent fail - let the subsequent validation handle it
			}
		}

		const org = await OrgEndpoints.#identity.organizations.getOrganization(ctx.params.orgId, ctx.token ?? undefined);
		if (!org) throw new IdentityError(404, "ORG_NOT_FOUND", "Organización no encontrada");
		assertReadableOrganizationAccess(ctx, org.orgId);
		return org;
	}
	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/organizations/:orgId/slug",
	})
	static async getOrganizationSlug(ctx: EndpointCtx<{ orgId: string }>) {
		const result = await OrgEndpoints.#identity.organizations.resolveOrganizationSlug(ctx.params.orgId, ctx.token!);
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
		const org = await OrgEndpoints.#identity.organizations.createOrganization(ctx.data.slug, ctx.data.region, ctx.data.metadata, ctx.token!);

		// Auto-crear roles predefinidos para la nueva organización
		await OrgEndpoints.#identity.roles.initializePredefinedRoles(org.orgId);
		OrgEndpoints.#identity.permissions.invalidateAll();

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
		const org = await OrgEndpoints.#identity.organizations.updateOrganization(ctx.params.orgId, ctx.data || {}, ctx.token!);
		OrgEndpoints.#identity.permissions.invalidateAll();
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
		await OrgEndpoints.#identity.organizations.deleteOrganization(ctx.params.orgId, ctx.token!, resumeFromStep);
		OrgEndpoints.#identity.permissions.invalidateAll();
		return { success: true };
	}

	// ── Miembros de organización ──────────────────────────────────────────────

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/organizations/:orgId/members",
		permissions: [P.IDENTITY.ORGANIZATIONS.READ],
	})
	static async listOrgMembers(ctx: EndpointCtx<{ orgId: string }>) {
		const org = await OrgEndpoints.#identity.organizations.getOrganization(ctx.params.orgId, ctx.token!);
		if (!org) throw new IdentityError(404, "ORG_NOT_FOUND", "Organización no encontrada");
		assertReadableOrganizationAccess(ctx, org.orgId);

		const members = await OrgEndpoints.#identity.users.getAllUsers(ctx.token!, ctx.params.orgId);
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
		const org = await OrgEndpoints.#identity.organizations.getOrganization(ctx.params.orgId, ctx.token!);
		if (!org) throw new IdentityError(404, "ORG_NOT_FOUND", "Organización no encontrada");

		await OrgEndpoints.#identity.users.addOrgMembership(ctx.params.userId, ctx.params.orgId, ctx.data?.roleIds || [], ctx.token!);
		OrgEndpoints.#identity.permissions.invalidateUser(ctx.params.userId);
		return { success: true };
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/organizations/:orgId/members/:userId",
		permissions: [P.IDENTITY.ORGANIZATIONS.DELETE],
	})
	static async removeOrgMember(ctx: EndpointCtx<{ orgId: string; userId: string }>) {
		requireGlobalAccess(ctx);
		await OrgEndpoints.#identity.users.removeOrgMembership(ctx.params.userId, ctx.params.orgId, ctx.token!);
		OrgEndpoints.#identity.permissions.invalidateUser(ctx.params.userId);
		return { success: true };
	}

	/**
	 * POST /api/identity/organizations/request
	 * Crear una solicitud de organización (crea ticket en PM)
	 * Acceso: autenticado (deferAuth para poder usar token de usuario)
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/organizations/request",
		deferAuth: true,
		options: { skipIdempotency: true },
	})
	static async requestOrganization(
		ctx: EndpointCtx<
			never,
			{
				name: string;
				email: string;
				description?: string;
				url?: string;
				socialNetworks?: Array<{ platform: string; url: string }>;
			}
		>
	) {
		try {
			const identity = OrgEndpoints.#identity;

			// Fallback: si ctx.user no está poblado pero hay token, verificar manualmente
			if (!ctx.user?.id && ctx.token) {
				try {
					const authVerifier = OrgEndpoints.#identity.createAuthVerifier();
					const result = await authVerifier.verifyToken(ctx.token);
					if (result.valid && result.userId) {
						(ctx as any).user = {
							id: result.userId,
							username: "user",
							email: undefined,
							permissions: [],
							orgId: result.orgId,
						};
					}
				} catch {
					// Silent fail - let the subsequent validation handle it
				}
			}

			// Validar autenticación - cualquier usuario autenticado puede solicitar
			if (!ctx.user?.id) {
				throw new IdentityError(401, "ORG_ACCESS_DENIED", "Debes estar autenticado para crear una solicitud de organización");
			}

			const { name, email, description, url, socialNetworks } = ctx.data || {};

			if (!name || !email) {
				throw new IdentityError(400, "MISSING_FIELDS", `Campos requeridos faltantes. Recibido: ${JSON.stringify(ctx.data)}`);
			}

			// Derivar slug y validar que no existe (sin crear la organización)
			const organizationSlug = name
				.toLowerCase()
				.trim()
				.replace(/[^a-z0-9\s-]/g, "")
				.replace(/\s+/g, "-")
				.replace(/-+/g, "-")
				.replace(/^-+|-+$/g, "");

			// Verificar que el slug no existe (sin crear la org)
			try {
				const existingOrg = await identity.organizations.getOrganization(organizationSlug, ctx.token ?? undefined);
				if (existingOrg) {
					throw new IdentityError(409, "INVALID_BODY", `El slug '${organizationSlug}' ya está en uso`);
				}
			} catch (error: any) {
				// Si es error de permisos (no admin), ignorar - el usuario puede solicitar aunque no vea todas las orgs
				if (error instanceof IdentityError && error.statusCode !== 409) {
					// Continuar sin validación cruzada
				} else if (error instanceof IdentityError) {
					throw error;
				}
			}

			const pm = OrgEndpoints.getProjectManager();
			if (!pm) {
				throw new IdentityError(500, "INVALID_BODY", `ProjectManagerService no disponible`);
			}

			// Intentar obtener proyecto org-requests existente o crearlo bajo demanda
			let project;
			const cachedProjectId = process.env.ORG_MANAGEMENT_PROJECT_ID;
			const projectOrgId = ctx.user?.orgId || null;

			if (cachedProjectId) {
				project = await pm.projects.getProject(cachedProjectId);
			}

			if (!project) {
				try {
					project = await pm.projects.getProjectBySlug("org-requests", projectOrgId, ctx.token ?? undefined);
				} catch {
					// No existe, crear bajo demanda
					const pmCtx: any = {
						userId: ctx.user.id,
						groupIds: [],
						tokenOrgId: null,
						isGlobalAdmin: true,
						hasGlobalPMRead: true,
						hasGlobalPMWrite: true,
						isOrgAdminOrPM: async () => true,
					};

					const newProject: any = {
						slug: "org-requests",
						name: "Organization Requests",
						description: "Solicitudes de creación de organizaciones en ADC Platform",
						visibility: "org",
						orgId: projectOrgId,
						kanbanColumns: [
							{ id: "col-1", key: "todo", name: "Pendiente", order: 0, isAuto: true },
							{ id: "col-2", key: "in-progress", name: "En revisión", order: 1 },
							{ id: "col-3", key: "approved", name: "Aprobada", order: 2, isDone: true, color: "#10b981" },
							{ id: "col-4", key: "rejected", name: "Rechazada", order: 3, isDone: true, color: "#ef4444" },
						],
						priorityStrategy: { id: "matrix-eisenhower" },
						settings: {},
					};

					try {
						project = await pm.projects.createProject(newProject, pmCtx);
						process.env.ORG_MANAGEMENT_PROJECT_ID = project.id;
					} catch (createErr: any) {
						if (createErr?.message?.includes("ya existe")) {
							try {
								project = await pm.projects.getProjectBySlug("org-requests", projectOrgId, ctx.token ?? undefined);
							} catch {
								throw new IdentityError(500, "INVALID_BODY", "No se puede acceder al proyecto org-requests");
							}
						} else {
							throw new IdentityError(500, "INVALID_BODY", `Error creando proyecto org-requests: ${createErr instanceof Error ? createErr.message : String(createErr)}`);
						}
					}
				}
			}

			if (!project) {
				throw new IdentityError(500, "INVALID_BODY", "No se pudo obtener ni crear el proyecto org-requests");
			}

			// Crear ticket en PM con metadata de solicitud
			const ticket = await pm.issues.create(
				project,
				{
					title: `Solicitud de Org: ${name}`,
					description: `**Solicitud de creación de organización**\n\n**Nombre:** ${name}\n**Email:** ${email}\n**URL:** ${url || "N/A"}\n**Descripción:** ${description || "Sin descripción"}`,
					category: "task",
					customFields: {
						type: "org_creation",
						organizationSlug,
						orgName: name,
						email,
						url: url || "",
						description: description || "",
						socialNetworks: socialNetworks || [],
						requestedByUserId: ctx.user.id,
					},
				},
				ctx.token, // Pasar el token del usuario autenticado
				{ userId: ctx.user.id, groupIds: [] }
			);

			return {
				success: true,
				ticketId: ticket.id,
				ticketKey: ticket.key,
				message: `Solicitud creada. El ID es ${ticket.key}. Los administradores la revisarán pronto.`,
			};
		} catch (error: any) {
			// Si ya es IdentityError, re-lanzar
			if (error instanceof IdentityError) {
				throw error;
			}

			throw new IdentityError(
				error.status || 500,
				error.errorKey || "INVALID_BODY",
				error.message || `Error creando solicitud`
			);
		}
	}


	/**
	 * Obtener acceso a ProjectManagerService
	 */
	private static getProjectManager() {
		try {
			const kernel = (OrgEndpoints.#identity as any)?.kernel;
			if (!kernel) return null;
			const pm = kernel.registry.getService("ProjectManagerService") as any;
			return pm || null;
		} catch {
			return null;
		}
	}
}
