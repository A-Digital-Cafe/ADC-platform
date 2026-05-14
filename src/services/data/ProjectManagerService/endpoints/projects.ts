import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import type ProjectManagerService from "../index.js";
import type { Project, KanbanColumn, ProjectSettings, PriorityStrategy } from "@common/types/project-manager/Project.ts";
import type { CustomFieldDef } from "@common/types/project-manager/CustomField.ts";
import type { IssueLinkType } from "@common/types/project-manager/IssueLink.ts";
import { normalizeSlug } from "@common/utils/project-manager/slug.ts";

const PROJECT_CREATE_RATE_LIMIT = { max: 10, timeWindow: 60_000 };
const PROJECT_WRITE_RATE_LIMIT = { max: 10, timeWindow: 60_000 };
const PROJECT_DELETE_RATE_LIMIT = { max: 2, timeWindow: 3_600_000 };

/** Resuelve un orgSlug a un orgId (null si es "default" = contexto global). */
async function resolveOrgSlug(service: ProjectManagerService, orgSlug: string, token?: string): Promise<string | null> {
	const slug = normalizeSlug(orgSlug);
	if (!slug) throw new ProjectManagerError(400, "INVALID_SLUG", `Slug de organización inválido: '${orgSlug}'`);
	if (slug === "default") return null;
	const identity = service.identity;
	const org = await identity.organizations.getOrganization(slug, token);
	if (!org) throw new ProjectManagerError(404, "ORG_ACCESS_DENIED", `Organización '${orgSlug}' no encontrada`);
	return org.orgId;
}

export class ProjectEndpoints {
	private static service: ProjectManagerService;
	private static kernelKey: symbol;
	static init(service: ProjectManagerService, kernelKey: symbol): void {
		ProjectEndpoints.service ??= service;
		ProjectEndpoints.kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/projects",
		deferAuth: true,
	})
	static async list(ctx: EndpointCtx) {
		const service = ProjectEndpoints.service;
		const projects = await service.listProjectsForCaller(ProjectEndpoints.kernelKey, ctx);
		return { projects };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/projects/check-slug/:orgSlug/:projectSlug",
		deferAuth: true,
	})
	static async checkSlug(ctx: EndpointCtx<{ orgSlug: string; projectSlug: string }>) {
		const service = ProjectEndpoints.service;
		const projectSlug = normalizeSlug(ctx.params.projectSlug);
		if (!projectSlug) return { available: false };
		const orgId = await resolveOrgSlug(service, ctx.params.orgSlug, ctx.token ?? undefined);
		const available = await service.projects.isSlugAvailable(projectSlug, orgId, ctx.token ?? undefined);
		return { available };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/projects/by-slug/:orgSlug/:projectSlug",
		deferAuth: true,
	})
	static async getBySlug(ctx: EndpointCtx<{ orgSlug: string; projectSlug: string }>) {
		const service = ProjectEndpoints.service;
		const caller = await service.resolveCaller(ProjectEndpoints.kernelKey, ctx);
		const projectSlug = normalizeSlug(ctx.params.projectSlug);
		if (!projectSlug) throw new ProjectManagerError(400, "INVALID_SLUG", `Slug de proyecto inválido: '${ctx.params.projectSlug}'`);
		const orgId = await resolveOrgSlug(service, ctx.params.orgSlug, ctx.token ?? undefined);
		const project = await service.projects.getProjectBySlug(projectSlug, orgId, ctx.token ?? undefined, caller);
		if (!project) throw new ProjectManagerError(404, "PROJECT_NOT_FOUND", "Proyecto no encontrado");
		return project;
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/pm/projects",
		// La autorización depende de `visibility`: público requiere admin global,
		// org requiere admin/PM de la org, privado cualquier usuario autenticado.
		deferAuth: true,
		options: { rateLimit: PROJECT_CREATE_RATE_LIMIT },
	})
	static async create(ctx: EndpointCtx<Record<string, string>, Partial<Project> & { name: string; slug: string }>) {
		if (!ctx.data?.name || !ctx.data?.slug) {
			throw new ProjectManagerError(400, "MISSING_FIELDS", "`name` y `slug` son requeridos");
		}
		const slug = normalizeSlug(ctx.data.slug);
		if (!slug) throw new ProjectManagerError(400, "INVALID_SLUG", `Slug inválido: '${ctx.data.slug}'`);
		const service = ProjectEndpoints.service;
		const pmCtx = await service.buildPMCtx(ProjectEndpoints.kernelKey, ctx);
		// Defensa en profundidad: ignoramos `ownerId` provisto por el cliente.
		const { ownerId: _ignored, ...safeInput } = ctx.data;
		const project = await service.projects.createProject({ ...safeInput, slug, ownerId: pmCtx.userId }, pmCtx, ctx.token ?? undefined);
		return project;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/projects/:id",
		deferAuth: true,
	})
	static async get(ctx: EndpointCtx<{ id: string }>) {
		const service = ProjectEndpoints.service;
		const caller = await service.resolveCaller(ProjectEndpoints.kernelKey, ctx);
		const project = await service.projects.getProject(ctx.params.id, ctx.token ?? undefined, caller);
		if (!project) throw new ProjectManagerError(404, "PROJECT_NOT_FOUND", "Proyecto no encontrado");
		return project;
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/pm/projects/:id",
		deferAuth: true,
		options: { rateLimit: PROJECT_WRITE_RATE_LIMIT },
	})
	static async update(ctx: EndpointCtx<{ id: string }, Partial<Project>>) {
		const service = ProjectEndpoints.service;
		const caller = await service.resolveCaller(ProjectEndpoints.kernelKey, ctx);
		return service.projects.updateProject(ctx.params.id, ctx.data ?? {}, ctx.token ?? undefined, caller);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/pm/projects/:id",
		deferAuth: true,
		options: { rateLimit: PROJECT_DELETE_RATE_LIMIT },
	})
	static async delete(ctx: EndpointCtx<{ id: string }>) {
		const service = ProjectEndpoints.service;
		const caller = await service.resolveCaller(ProjectEndpoints.kernelKey, ctx);
		await service.projects.deleteProject(ctx.params.id, ctx.token ?? undefined, caller);
		return { ok: true };
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/pm/projects/:id/members",
		deferAuth: true,
		options: { rateLimit: PROJECT_WRITE_RATE_LIMIT },
	})
	static async updateMembers(ctx: EndpointCtx<{ id: string }, { memberUserIds: string[]; memberGroupIds: string[] }>) {
		const data = ctx.data ?? { memberUserIds: [], memberGroupIds: [] };
		if (!Array.isArray(data.memberUserIds) || !Array.isArray(data.memberGroupIds)) {
			throw new ProjectManagerError(400, "INVALID_FIELD", "`memberUserIds` y `memberGroupIds` deben ser arrays");
		}
		const service = ProjectEndpoints.service;
		const caller = await service.resolveCaller(ProjectEndpoints.kernelKey, ctx);
		return service.projects.updateProject(
			ctx.params.id,
			{ memberUserIds: data.memberUserIds, memberGroupIds: data.memberGroupIds },
			ctx.token ?? undefined,
			caller
		);
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/pm/projects/:id/columns",
		deferAuth: true,
		options: { rateLimit: PROJECT_WRITE_RATE_LIMIT },
	})
	static async updateColumns(ctx: EndpointCtx<{ id: string }, { kanbanColumns: KanbanColumn[] }>) {
		const columns = ctx.data?.kanbanColumns;
		if (!Array.isArray(columns)) throw new ProjectManagerError(400, "INVALID_FIELD", "`kanbanColumns` debe ser un array");
		const service = ProjectEndpoints.service;
		const caller = await service.resolveCaller(ProjectEndpoints.kernelKey, ctx);
		return service.projects.updateProject(ctx.params.id, { kanbanColumns: columns }, ctx.token ?? undefined, caller);
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/pm/projects/:id/custom-fields",
		deferAuth: true,
		options: { rateLimit: PROJECT_WRITE_RATE_LIMIT },
	})
	static async updateCustomFields(ctx: EndpointCtx<{ id: string }, { customFieldDefs: CustomFieldDef[] }>) {
		const defs = ctx.data?.customFieldDefs;
		if (!Array.isArray(defs)) throw new ProjectManagerError(400, "INVALID_FIELD", "`customFieldDefs` debe ser un array");
		for (const def of defs) {
			if (def.type === "label" && (!Array.isArray(def.options) || def.options.length === 0)) {
				throw new ProjectManagerError(400, "INVALID_FIELD", `Campo '${def.name}' tipo 'label' requiere opciones`);
			}
		}
		const service = ProjectEndpoints.service;
		const caller = await service.resolveCaller(ProjectEndpoints.kernelKey, ctx);
		return service.projects.updateProject(ctx.params.id, { customFieldDefs: defs }, ctx.token ?? undefined, caller);
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/pm/projects/:id/link-types",
		deferAuth: true,
		options: { rateLimit: PROJECT_WRITE_RATE_LIMIT },
	})
	static async updateLinkTypes(ctx: EndpointCtx<{ id: string }, { issueLinkTypes: IssueLinkType[] }>) {
		const types = ctx.data?.issueLinkTypes;
		if (!Array.isArray(types)) throw new ProjectManagerError(400, "INVALID_FIELD", "`issueLinkTypes` debe ser un array");
		const service = ProjectEndpoints.service;
		const caller = await service.resolveCaller(ProjectEndpoints.kernelKey, ctx);
		return service.projects.updateProject(ctx.params.id, { issueLinkTypes: types }, ctx.token ?? undefined, caller);
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/pm/projects/:id/priority-strategy",
		deferAuth: true,
		options: { rateLimit: PROJECT_WRITE_RATE_LIMIT },
	})
	static async updatePriorityStrategy(ctx: EndpointCtx<{ id: string }, { priorityStrategy: PriorityStrategy }>) {
		const strategy = ctx.data?.priorityStrategy;
		if (!strategy?.id) throw new ProjectManagerError(400, "INVALID_FIELD", "`priorityStrategy.id` es requerido");
		const service = ProjectEndpoints.service;
		const caller = await service.resolveCaller(ProjectEndpoints.kernelKey, ctx);
		return service.projects.updateProject(ctx.params.id, { priorityStrategy: strategy }, ctx.token ?? undefined, caller);
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/pm/projects/:id/settings",
		deferAuth: true,
		options: { rateLimit: PROJECT_WRITE_RATE_LIMIT },
	})
	static async updateSettings(ctx: EndpointCtx<{ id: string }, { settings: ProjectSettings }>) {
		const settings = ctx.data?.settings;
		if (!settings || typeof settings !== "object") {
			throw new ProjectManagerError(400, "INVALID_FIELD", "`settings` debe ser un objeto");
		}
		const service = ProjectEndpoints.service;
		const caller = await service.resolveCaller(ProjectEndpoints.kernelKey, ctx);
		return service.projects.updateProject(ctx.params.id, { settings }, ctx.token ?? undefined, caller);
	}
}
