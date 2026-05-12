import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import type ProjectManagerService from "../index.js";
import type { Block } from "@common/ADC/types/learning.ts";
import type { CommentLabel, CommentsPage } from "@common/types/comments/Comment.ts";
import { buildIssueResourceCtx } from "./utils/issueResourceCtx.ts";

const COMMENT_RATE_LIMIT = { max: 30, timeWindow: 60_000 };
const REACT_RATE_LIMIT = { max: 60, timeWindow: 60_000 };
const DRAFT_RATE_LIMIT = { max: 60, timeWindow: 60_000 };

/** Tipo de target estándar para issues del Project Manager. */
const TARGET_TYPE = "pm-issue";

interface CreateBody {
	blocks: Block[];
	parentId?: string | null;
	attachmentIds?: string[];
	label?: CommentLabel;
}

interface UpdateBody {
	blocks: Block[];
	attachmentIds?: string[];
}

interface DraftBody {
	blocks: Block[];
	attachmentIds?: string[];
	parentId?: string | null;
	editingCommentId?: string | null;
}

/**
 * Rehidrata autores con Identity en cada lectura. `authorImage` en comentarios
 * queda como snapshot histórico; para UI debe prevalecer la selección actual
 * del usuario (`default`, `custom`, `linked:*`, `none`).
 */
async function attachFreshAuthorProfiles(service: ProjectManagerService, page: CommentsPage): Promise<CommentsPage> {
	if (page.items.length === 0) return page;
	const authorIds = Array.from(new Set(page.items.map((c) => c.authorId).filter(Boolean)));
	if (authorIds.length === 0) return page;

	try {
		const profiles = await service.identity.users.getPublicProfiles(authorIds);
		for (const comment of page.items) {
			const profile = profiles.get(comment.authorId);
			if (!profile) continue;
			comment.authorName = profile.username ?? comment.authorName;
			comment.authorImage = profile.avatar;
		}
	} catch {
		// Identity no disponible: dejamos el snapshot persistido en el comentario.
	}

	return page;
}

/**
 * En creación sí necesitamos guardar un snapshot razonable del autor, pero no
 * queremos resolverlo en `verifyToken` para cada request de la plataforma.
 * Hacemos esta lectura sólo en el write de comentario, que es mucho menos
 * frecuente que validar tokens.
 */
async function attachFreshAuthorProfileToCtx(service: ProjectManagerService, commentCtx: { userId: string; authorName?: string; authorImage?: string | null }) {
	if (!commentCtx.userId) return;
	try {
		const profiles = await service.identity.users.getPublicProfiles([commentCtx.userId]);
		const profile = profiles.get(commentCtx.userId);
		if (!profile) return;
		commentCtx.authorName = profile.username ?? commentCtx.authorName;
		commentCtx.authorImage = profile.avatar;
	} catch {
		// Identity no disponible: se conserva lo que venga de la sesión/token.
	}
}

export class IssueCommentsEndpoints {
	static #service: ProjectManagerService;
	static #kernelKey: symbol;

	static init(service: ProjectManagerService, kernelKey: symbol): void {
		IssueCommentsEndpoints.#service ??= service;
		IssueCommentsEndpoints.#kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/issues/:id/comments",
		deferAuth: true,
	})
	static async list(ctx: EndpointCtx<{ id: string }>) {
		const svc = IssueCommentsEndpoints.#service;
		const { issue, commentCtx } = await buildIssueResourceCtx(svc, IssueCommentsEndpoints.#kernelKey, ctx);
		const cursor = ctx.query.cursor || null;
		// Si la query no especifica `parentId`, devolvemos todos los comentarios
		// del issue en flat (incluye replies bajo padres eliminados). El cliente
		// reconstruye el \u00e1rbol con `buildCommentsTree`. Si llega expl\u00edcitamente
		// (string vac\u00edo o "null") = solo ra\u00edces; otro valor = replies de ese padre.
		const parentId = ctx.query.parentId === undefined ? undefined : ctx.query.parentId || null;
		const limit = ctx.query.limit ? Number(ctx.query.limit) : undefined;
		const page = await svc.issueComments.list(commentCtx, {
			targetType: TARGET_TYPE,
			targetId: issue.id,
			parentId,
			cursor,
			limit,
		});
		return attachFreshAuthorProfiles(svc, page);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/issues/:id/comments/threads/:rootId",
		deferAuth: true,
	})
	static async thread(ctx: EndpointCtx<{ id: string; rootId: string }>) {
		const svc = IssueCommentsEndpoints.#service;
		const { commentCtx } = await buildIssueResourceCtx(svc, IssueCommentsEndpoints.#kernelKey, ctx);
		const cursor = ctx.query.cursor || null;
		const limit = ctx.query.limit ? Number(ctx.query.limit) : undefined;
		const page = await svc.issueComments.getThread(commentCtx, ctx.params.rootId, { cursor, limit });
		return attachFreshAuthorProfiles(svc, page);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/issues/:id/comments/count",
		deferAuth: true,
	})
	static async count(ctx: EndpointCtx<{ id: string }>) {
		const svc = IssueCommentsEndpoints.#service;
		const { issue, commentCtx } = await buildIssueResourceCtx(svc, IssueCommentsEndpoints.#kernelKey, ctx);
		const total = await svc.issueComments.count(commentCtx, { targetType: TARGET_TYPE, targetId: issue.id });
		return { total };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/pm/issues/:id/comments",
		deferAuth: true,
		options: { rateLimit: COMMENT_RATE_LIMIT },
	})
	static async create(ctx: EndpointCtx<{ id: string }, CreateBody>) {
		if (!ctx.data?.blocks?.length) throw new ProjectManagerError(400, "MISSING_FIELDS", "`blocks` requerido");
		const svc = IssueCommentsEndpoints.#service;
		const { issue, commentCtx } = await buildIssueResourceCtx(svc, IssueCommentsEndpoints.#kernelKey, ctx, { requireAuth: true });
		await attachFreshAuthorProfileToCtx(svc, commentCtx);
		return svc.issueComments.create(commentCtx, {
			targetType: TARGET_TYPE,
			targetId: issue.id,
			parentId: ctx.data.parentId ?? null,
			blocks: ctx.data.blocks,
			attachmentIds: ctx.data.attachmentIds,
			label: ctx.data.label,
		});
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/pm/issues/:id/comments/:commentId",
		deferAuth: true,
		options: { rateLimit: COMMENT_RATE_LIMIT },
	})
	static async update(ctx: EndpointCtx<{ id: string; commentId: string }, UpdateBody>) {
		if (!ctx.data?.blocks?.length) throw new ProjectManagerError(400, "MISSING_FIELDS", "`blocks` requerido");
		const svc = IssueCommentsEndpoints.#service;
		const { commentCtx } = await buildIssueResourceCtx(svc, IssueCommentsEndpoints.#kernelKey, ctx, { requireAuth: true });
		return svc.issueComments.update(commentCtx, ctx.params.commentId, {
			blocks: ctx.data.blocks,
			attachmentIds: ctx.data.attachmentIds,
		});
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/pm/issues/:id/comments/:commentId",
		deferAuth: true,
		options: { rateLimit: COMMENT_RATE_LIMIT },
	})
	static async delete(ctx: EndpointCtx<{ id: string; commentId: string }>) {
		const svc = IssueCommentsEndpoints.#service;
		const { commentCtx } = await buildIssueResourceCtx(svc, IssueCommentsEndpoints.#kernelKey, ctx, { requireAuth: true });
		await svc.issueComments.delete(commentCtx, ctx.params.commentId);
		return { ok: true };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/pm/issues/:id/comments/:commentId/reactions/:emoji",
		deferAuth: true,
		options: { rateLimit: REACT_RATE_LIMIT },
	})
	static async react(ctx: EndpointCtx<{ id: string; commentId: string; emoji: string }>) {
		const svc = IssueCommentsEndpoints.#service;
		const { commentCtx } = await buildIssueResourceCtx(svc, IssueCommentsEndpoints.#kernelKey, ctx, { requireAuth: true });
		const emoji = decodeURIComponent(ctx.params.emoji);
		return svc.issueComments.react(commentCtx, ctx.params.commentId, emoji);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/pm/issues/:id/comments/:commentId/reactions/:emoji",
		deferAuth: true,
		options: { rateLimit: REACT_RATE_LIMIT },
	})
	static async unreact(ctx: EndpointCtx<{ id: string; commentId: string; emoji: string }>) {
		const svc = IssueCommentsEndpoints.#service;
		const { commentCtx } = await buildIssueResourceCtx(svc, IssueCommentsEndpoints.#kernelKey, ctx, { requireAuth: true });
		const emoji = decodeURIComponent(ctx.params.emoji);
		return svc.issueComments.unreact(commentCtx, ctx.params.commentId, emoji);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/issues/:id/comments/draft",
		deferAuth: true,
	})
	static async getDraft(ctx: EndpointCtx<{ id: string }>) {
		const svc = IssueCommentsEndpoints.#service;
		const { issue, commentCtx } = await buildIssueResourceCtx(svc, IssueCommentsEndpoints.#kernelKey, ctx, { requireAuth: true });
		const parentId = ctx.query.parentId === undefined ? null : ctx.query.parentId || null;
		const editingCommentId = ctx.query.editingCommentId === undefined ? null : ctx.query.editingCommentId || null;
		const draft = await svc.issueComments.getDraft(commentCtx, {
			targetType: TARGET_TYPE,
			targetId: issue.id,
			parentId,
			editingCommentId,
		});
		return { draft };
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/pm/issues/:id/comments/draft",
		deferAuth: true,
		options: { rateLimit: DRAFT_RATE_LIMIT, skipIdempotency: true },
	})
	static async saveDraft(ctx: EndpointCtx<{ id: string }, DraftBody>) {
		if (!Array.isArray(ctx.data?.blocks)) throw new ProjectManagerError(400, "MISSING_FIELDS", "`blocks` requerido");
		const svc = IssueCommentsEndpoints.#service;
		const { issue, commentCtx } = await buildIssueResourceCtx(svc, IssueCommentsEndpoints.#kernelKey, ctx, { requireAuth: true });
		return svc.issueComments.saveDraft(
			commentCtx,
			{
				targetType: TARGET_TYPE,
				targetId: issue.id,
				parentId: ctx.data.parentId ?? null,
				editingCommentId: ctx.data.editingCommentId ?? null,
			},
			{ blocks: ctx.data.blocks, attachmentIds: ctx.data.attachmentIds }
		);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/pm/issues/:id/comments/draft",
		deferAuth: true,
		options: { skipIdempotency: true },
	})
	static async deleteDraft(ctx: EndpointCtx<{ id: string }>) {
		const svc = IssueCommentsEndpoints.#service;
		const { issue, commentCtx } = await buildIssueResourceCtx(svc, IssueCommentsEndpoints.#kernelKey, ctx, { requireAuth: true });
		const parentId = ctx.query.parentId === undefined ? null : ctx.query.parentId || null;
		const editingCommentId = ctx.query.editingCommentId === undefined ? null : ctx.query.editingCommentId || null;
		await svc.issueComments.deleteDraft(commentCtx, {
			targetType: TARGET_TYPE,
			targetId: issue.id,
			parentId,
			editingCommentId,
		});
		return { ok: true };
	}
}
