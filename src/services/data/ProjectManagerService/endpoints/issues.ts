import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import type ProjectManagerService from "../index.js";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { IssueListFilters } from "../dao/issues.ts";
import type { Block } from "@common/ADC/types/learning.ts";
import { buildIssueResourceCtx } from "./utils/issueResourceCtx.ts";
import { assertCommentForFinalTransition } from "./utils/transitionGuards.ts";
import { validateAndSanitizeIssueDescription } from "./utils/validateIssueDescription.ts";

const ISSUE_CREATE_RATE_LIMIT = { max: 20, timeWindow: 60_000 };
const ISSUE_UPDATE_RATE_LIMIT = { max: 20, timeWindow: 60_000 };
const ISSUE_DELETE_RATE_LIMIT = { max: 5, timeWindow: 60_000 };
const ISSUE_MOVE_RATE_LIMIT = { max: 20, timeWindow: 60_000 };

/**
 * Resuelve perfiles públicos (username/avatar para usuarios, name/description
 * para grupos) referenciados por `reporterId`, `assigneeIds` y
 * `assigneeGroupIds` y los anexa a cada issue como `assigneeProfiles` /
 * `assigneeGroupProfiles`. Esto permite al frontend renderizar nombres sin
 * llamar a Identity (que podría devolver 401/403 si el usuario no tiene
 * permisos para leer `users`/`groups`).
 *
 * Tolera fallos: si IdentityManagerService no responde, devuelve los issues
 * tal cual (los pickers harán fallback a IDs como hasta ahora).
 */
async function attachAssigneeProfiles<T extends Issue | Issue[]>(service: ProjectManagerService, target: T): Promise<T> {
	const list = Array.isArray(target) ? target : [target];
	if (list.length === 0) return target;
	const userIds = new Set<string>();
	const groupIds = new Set<string>();
	for (const i of list) {
		if (i.reporterId) userIds.add(i.reporterId);
		for (const id of i.assigneeIds ?? []) userIds.add(id);
		for (const id of i.assigneeGroupIds ?? []) groupIds.add(id);
	}
	try {
		const identity = service.identity;
		const [userMap, groupMap] = await Promise.all([
			userIds.size ? identity.users.getPublicProfiles([...userIds]) : Promise.resolve(new Map()),
			groupIds.size ? identity.groups.getPublicProfiles([...groupIds]) : Promise.resolve(new Map()),
		]);
		for (const i of list) {
			const ups: Record<string, { username?: string; avatar?: string }> = {};
			for (const id of new Set([i.reporterId, ...(i.assigneeIds ?? [])])) {
				const p = userMap.get(id);
				if (p) ups[id] = p;
			}
			i.assigneeProfiles = ups;
			const gps: Record<string, { name: string; description?: string }> = {};
			for (const id of i.assigneeGroupIds ?? []) {
				const p = groupMap.get(id);
				if (p) gps[id] = p;
			}
			i.assigneeGroupProfiles = gps;
		}
	} catch {
		// Identity no disponible: dejamos los issues sin enriquecer.
	}
	return target;
}

export class IssueEndpoints {
	static #service: ProjectManagerService;
	static #kernelKey: symbol;
	static init(service: ProjectManagerService, kernelKey: symbol): void {
		IssueEndpoints.#service ??= service;
		IssueEndpoints.#kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/projects/:projectId/issues",
		deferAuth: true,
	})
	static async list(ctx: EndpointCtx<{ projectId: string }>) {
		const service = IssueEndpoints.#service;
		const caller = await service.resolveCaller(IssueEndpoints.#kernelKey, ctx);
		const project = await service.projects.getProject(ctx.params.projectId, ctx.token ?? undefined, caller);
		if (!project) throw new ProjectManagerError(404, "PROJECT_NOT_FOUND", "Proyecto no encontrado");

		const filters: IssueListFilters = {
			sprintId: ctx.query.sprintId || undefined,
			milestoneId: ctx.query.milestoneId || undefined,
			assigneeId: ctx.query.assigneeId || undefined,
			columnKey: ctx.query.columnKey || undefined,
			q: ctx.query.q || undefined,
			orderBy: (ctx.query.orderBy as IssueListFilters["orderBy"]) || undefined,
		};

		const issues = await service.issues.list(project, filters, ctx.token ?? undefined, caller);
		await attachAssigneeProfiles(service, issues);
		return { issues, project };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/pm/projects/:projectId/issues",
		deferAuth: true,
		options: { rateLimit: ISSUE_CREATE_RATE_LIMIT },
	})
	static async create(ctx: EndpointCtx<{ projectId: string }, Partial<Issue> & { title: string }>) {
		if (!ctx.data?.title) throw new ProjectManagerError(400, "MISSING_FIELDS", "`title` es requerido");
		const service = IssueEndpoints.#service;
		const caller = await service.resolveCaller(IssueEndpoints.#kernelKey, ctx);
		const project = await service.projects.getProject(ctx.params.projectId, ctx.token ?? undefined, caller);
		if (!project) throw new ProjectManagerError(404, "PROJECT_NOT_FOUND", "Proyecto no encontrado");
		const data = { ...ctx.data };
		// Validar adjuntos referenciados en la descripción con el mismo criterio
		// que comments (ownership + permiso). En `create` el issue aún no existe,
		// así que evaluamos el contexto contra el proyecto + un issue "sintético".
		if (Array.isArray(data.description) && data.description.length) {
			const pmCtx = await service.buildPMCtx(IssueEndpoints.#kernelKey, ctx);
			const syntheticAttachmentCtx = {
				userId: ctx.user?.id ?? "",
				tokenOrgId: ctx.user?.orgId ?? null,
				project,
				issue: { reporterId: ctx.user?.id ?? "", assigneeIds: [], assigneeGroupIds: [] } as unknown as Issue,
				pmCtx,
			};
			data.description = await validateAndSanitizeIssueDescription(service, syntheticAttachmentCtx, data.description);
		}
		const issue = await service.issues.create(project, data, ctx.token ?? undefined, caller);
		if (caller.userId) {
			await service.issueDescriptionDrafts
				.delete(caller.userId, { targetType: "pm-issue-description", targetId: issue.id })
				.catch(() => undefined);
		}
		return await attachAssigneeProfiles(service, issue);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/issues/:id",
		deferAuth: true,
	})
	static async get(ctx: EndpointCtx<{ id: string }>) {
		const service = IssueEndpoints.#service;
		const caller = await service.resolveCaller(IssueEndpoints.#kernelKey, ctx);
		const issue = await service.issues.get(ctx.params.id, ctx.token ?? undefined, caller);
		if (!issue) throw new ProjectManagerError(404, "ISSUE_NOT_FOUND", "Issue no encontrado");
		return await attachAssigneeProfiles(service, issue);
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/pm/issues/:id",
		deferAuth: true,
		options: { rateLimit: ISSUE_UPDATE_RATE_LIMIT },
	})
	static async update(ctx: EndpointCtx<{ id: string }, Partial<Issue> & { reason?: string }>) {
		const service = IssueEndpoints.#service;
		const caller = await service.resolveCaller(IssueEndpoints.#kernelKey, ctx);
		const { reason, ...updates } = ctx.data ?? {};
		// Si se actualiza la descripción, validar adjuntos contra el contexto real
		// del issue (project + issue resueltos).
		if (Array.isArray(updates.description)) {
			const built = await buildIssueResourceCtx(service, IssueEndpoints.#kernelKey, ctx, { requireAuth: true });
			updates.description = await validateAndSanitizeIssueDescription(service, built.attachmentCtx, updates.description);
		}
		const updated = await service.issues.update(ctx.params.id, updates, reason, ctx.token ?? undefined, caller);
		if (caller.userId && updates.description !== undefined) {
			await service.issueDescriptionDrafts
				.delete(caller.userId, { targetType: "pm-issue-description", targetId: updated.id })
				.catch(() => undefined);
		}
		return await attachAssigneeProfiles(service, updated);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/pm/issues/:id",
		deferAuth: true,
		options: { rateLimit: ISSUE_DELETE_RATE_LIMIT },
	})
	static async delete(ctx: EndpointCtx<{ id: string }>) {
		const service = IssueEndpoints.#service;
		const caller = await service.resolveCaller(IssueEndpoints.#kernelKey, ctx);
		await service.issues.delete(ctx.params.id, ctx.token ?? undefined, caller);
		return { ok: true };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/pm/issues/:id/move",
		deferAuth: true,
		options: { rateLimit: ISSUE_MOVE_RATE_LIMIT },
	})
	static async move(
		ctx: EndpointCtx<{ id: string }, { columnKey: string; reason?: string; commentBlocks?: Block[]; commentAttachmentIds?: string[] }>
	) {
		if (!ctx.data?.columnKey) throw new ProjectManagerError(400, "MISSING_FIELDS", "`columnKey` es requerido");
		const service = IssueEndpoints.#service;
		const kernelKey = IssueEndpoints.#kernelKey;
		const caller = await service.resolveCaller(kernelKey, ctx);

		// Pre-resolución para validar la transición y comprobar el flag del proyecto
		// antes de mover el issue.
		const pre = await buildIssueResourceCtx(service, kernelKey, ctx, { requireAuth: true });
		const commentBlocks = ctx.data.commentBlocks;
		assertCommentForFinalTransition(pre.project, ctx.data.columnKey, commentBlocks);

		const updated = await service.issues.move(ctx.params.id, ctx.data.columnKey, ctx.data.reason, ctx.token ?? undefined, caller);

		// Si se proporcionó un comentario (obligatorio o no), se persiste con
		// `label = "transition-reason"` para destacarlo en el historial.
		if (commentBlocks?.length) {
			try {
				await service.issueComments.create(pre.commentCtx, {
					targetType: "pm-issue",
					targetId: updated.id,
					blocks: commentBlocks,
					attachmentIds: ctx.data.commentAttachmentIds,
					label: "transition-reason",
					meta: {
						fromColumn: pre.issue.columnKey,
						toColumn: updated.columnKey,
						reason: ctx.data.reason,
					},
				});
			} catch (e) {
				console.warn(`[ProjectManager] Move OK pero falló el comentario de transición: ${(e as Error).message}`);
			}
		}

		return await attachAssigneeProfiles(service, updated);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/issues/:id/history",
		deferAuth: true,
	})
	static async history(ctx: EndpointCtx<{ id: string }>) {
		const service = IssueEndpoints.#service;
		const caller = await service.resolveCaller(IssueEndpoints.#kernelKey, ctx);
		const issue = await service.issues.get(ctx.params.id, ctx.token ?? undefined, caller);
		if (!issue) throw new ProjectManagerError(404, "ISSUE_NOT_FOUND", "Issue no encontrado");
		return { updateLog: issue.updateLog };
	}
}
