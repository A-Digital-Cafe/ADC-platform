import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import type ProjectManagerService from "../index.js";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { IssueListFilters } from "../dao/issues.ts";
import type { Block } from "@common/ADC/types/learning.ts";
import { buildIssueResourceCtx } from "./utils/issueResourceCtx.ts";
import { assertCommentForFinalTransition } from "./utils/transitionGuards.ts";

const ISSUE_CREATE_RATE_LIMIT = { max: 20, timeWindow: 60_000 };
const ISSUE_UPDATE_RATE_LIMIT = { max: 20, timeWindow: 60_000 };
const ISSUE_DELETE_RATE_LIMIT = { max: 5, timeWindow: 60_000 };
const ISSUE_MOVE_RATE_LIMIT = { max: 20, timeWindow: 60_000 };

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
		return service.issues.create(project, ctx.data, ctx.token ?? undefined, caller);
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
		return issue;
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
		return service.issues.update(ctx.params.id, updates, reason, ctx.token ?? undefined, caller);
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
		if (commentBlocks && commentBlocks.length) {
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

		return updated;
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
