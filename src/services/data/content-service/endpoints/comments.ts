import type { Model } from "mongoose";
import type { Article, Block } from "../../../../common/ADC/types/learning.js";
import type { CommentLabel, CommentsPage } from "../../../../common/types/comments/Comment.ts";
import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { HttpError } from "@common/types/ADCCustomError.ts";
import type { CommentsManager } from "../../../../utilities/comments/comments-utility/index.js";
import type IdentityManagerService from "../../../core/IdentityManagerService/index.js";
import { buildArticleResourceCtx } from "./utils/articleResourceCtx.ts";

interface SlugParams {
	slug: string;
}

interface SlugCommentParams {
	slug: string;
	commentId: string;
}

interface SlugCommentReactionParams extends SlugCommentParams {
	emoji: string;
}

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

const TARGET_TYPE = "article";

const COMMENT_RATE_LIMIT = { max: 30, timeWindow: 60_000 };
const REACT_RATE_LIMIT = { max: 60, timeWindow: 60_000 };
const DRAFT_RATE_LIMIT = { max: 60, timeWindow: 60_000 };

export class CommentEndpoints {
	static #articleModel: Model<Article>;
	static #commentsManager: CommentsManager | null = null;
	static #identity: IdentityManagerService | null = null;

	static init(articleModel: Model<Article>, commentsManager: CommentsManager, identity: IdentityManagerService | null = null): void {
		CommentEndpoints.#articleModel ??= articleModel;
		CommentEndpoints.#commentsManager ??= commentsManager;
		CommentEndpoints.#identity ??= identity;
	}

	static get articleModel(): Model<Article> {
		return CommentEndpoints.#articleModel;
	}

	static #manager(): CommentsManager {
		if (!CommentEndpoints.#commentsManager) {
			throw new HttpError(503, "COMMENTS_UNAVAILABLE", "Comentarios no disponibles");
		}
		return CommentEndpoints.#commentsManager;
	}

	static async #attachFreshAuthorProfiles(page: CommentsPage): Promise<CommentsPage> {
		const identity = CommentEndpoints.#identity;
		if (!identity || page.items.length === 0) return page;
		const authorIds = Array.from(new Set(page.items.map((c) => c.authorId).filter(Boolean)));
		if (authorIds.length === 0) return page;

		try {
			const profiles = await identity.users.getPublicProfiles(authorIds);
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

	static async #attachFreshAuthorProfileToCtx(commentCtx: { userId: string; authorName?: string; authorImage?: string | null }) {
		const identity = CommentEndpoints.#identity;
		if (!identity || !commentCtx.userId) return;
		try {
			const profiles = await identity.users.getPublicProfiles([commentCtx.userId]);
			const profile = profiles.get(commentCtx.userId);
			if (!profile) return;
			commentCtx.authorName = profile.username ?? commentCtx.authorName;
			commentCtx.authorImage = profile.avatar;
		} catch {
			// Identity no disponible: se conserva lo que venga de la sesión/token.
		}
	}

	@RegisterEndpoint({ method: "GET", url: "/api/learning/articles/:slug/comments", deferAuth: true })
	static async list(ctx: EndpointCtx<SlugParams>) {
		const { commentCtx, articleSlug } = await buildArticleResourceCtx(CommentEndpoints.articleModel, ctx);
		const cursor = ctx.query.cursor || null;
		// Sin `parentId` en la query => devolver todos los comentarios del art\u00edculo
		// en flat (incluye replies de padres eliminados); el cliente arma el \u00e1rbol.
		const parentId = ctx.query.parentId === undefined ? undefined : ctx.query.parentId || null;
		const limit = ctx.query.limit ? Number(ctx.query.limit) : undefined;
		const page = await CommentEndpoints.#manager().list(commentCtx, {
			targetType: TARGET_TYPE,
			targetId: articleSlug,
			parentId,
			cursor,
			limit,
		});
		return CommentEndpoints.#attachFreshAuthorProfiles(page);
	}

	@RegisterEndpoint({ method: "GET", url: "/api/learning/articles/:slug/comments/threads/:rootId", deferAuth: true })
	static async thread(ctx: EndpointCtx<{ slug: string; rootId: string }>) {
		const { commentCtx } = await buildArticleResourceCtx(CommentEndpoints.articleModel, ctx);
		const cursor = ctx.query.cursor || null;
		const limit = ctx.query.limit ? Number(ctx.query.limit) : undefined;
		const page = await CommentEndpoints.#manager().getThread(commentCtx, ctx.params.rootId, { cursor, limit });
		return CommentEndpoints.#attachFreshAuthorProfiles(page);
	}

	@RegisterEndpoint({ method: "GET", url: "/api/learning/articles/:slug/comments/count", deferAuth: true })
	static async count(ctx: EndpointCtx<SlugParams>) {
		const { commentCtx, articleSlug } = await buildArticleResourceCtx(CommentEndpoints.articleModel, ctx);
		const total = await CommentEndpoints.#manager().count(commentCtx, { targetType: TARGET_TYPE, targetId: articleSlug });
		return { total };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/learning/articles/:slug/comments",
		deferAuth: true,
		options: { rateLimit: COMMENT_RATE_LIMIT },
	})
	static async create(ctx: EndpointCtx<SlugParams, CreateBody>) {
		if (!ctx.data?.blocks?.length) throw new HttpError(400, "MISSING_FIELDS", "`blocks` requerido");
		const { commentCtx, articleSlug } = await buildArticleResourceCtx(CommentEndpoints.articleModel, ctx, {
			requireAuth: true,
			requireListed: true,
		});
		await CommentEndpoints.#attachFreshAuthorProfileToCtx(commentCtx);
		return CommentEndpoints.#manager().create(commentCtx, {
			targetType: TARGET_TYPE,
			targetId: articleSlug,
			parentId: ctx.data.parentId ?? null,
			blocks: ctx.data.blocks,
			attachmentIds: ctx.data.attachmentIds,
			label: ctx.data.label,
		});
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/learning/articles/:slug/comments/:commentId",
		deferAuth: true,
		options: { rateLimit: COMMENT_RATE_LIMIT },
	})
	static async update(ctx: EndpointCtx<SlugCommentParams, UpdateBody>) {
		if (!ctx.data?.blocks?.length) throw new HttpError(400, "MISSING_FIELDS", "`blocks` requerido");
		const { commentCtx } = await buildArticleResourceCtx(CommentEndpoints.articleModel, ctx, { requireAuth: true });
		return CommentEndpoints.#manager().update(commentCtx, ctx.params.commentId, {
			blocks: ctx.data.blocks,
			attachmentIds: ctx.data.attachmentIds,
		});
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/learning/articles/:slug/comments/:commentId",
		deferAuth: true,
		options: { rateLimit: COMMENT_RATE_LIMIT },
	})
	static async remove(ctx: EndpointCtx<SlugCommentParams>) {
		const { commentCtx } = await buildArticleResourceCtx(CommentEndpoints.articleModel, ctx, { requireAuth: true });
		await CommentEndpoints.#manager().delete(commentCtx, ctx.params.commentId);
		return { ok: true };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/learning/articles/:slug/comments/:commentId/reactions/:emoji",
		deferAuth: true,
		options: { rateLimit: REACT_RATE_LIMIT },
	})
	static async react(ctx: EndpointCtx<SlugCommentReactionParams>) {
		const { commentCtx } = await buildArticleResourceCtx(CommentEndpoints.articleModel, ctx, { requireAuth: true });
		const emoji = decodeURIComponent(ctx.params.emoji);
		return CommentEndpoints.#manager().react(commentCtx, ctx.params.commentId, emoji);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/learning/articles/:slug/comments/:commentId/reactions/:emoji",
		deferAuth: true,
		options: { rateLimit: REACT_RATE_LIMIT },
	})
	static async unreact(ctx: EndpointCtx<SlugCommentReactionParams>) {
		const { commentCtx } = await buildArticleResourceCtx(CommentEndpoints.articleModel, ctx, { requireAuth: true });
		const emoji = decodeURIComponent(ctx.params.emoji);
		return CommentEndpoints.#manager().unreact(commentCtx, ctx.params.commentId, emoji);
	}

	@RegisterEndpoint({ method: "GET", url: "/api/learning/articles/:slug/comments/draft", deferAuth: true })
	static async getDraft(ctx: EndpointCtx<SlugParams>) {
		const { commentCtx, articleSlug } = await buildArticleResourceCtx(CommentEndpoints.articleModel, ctx, { requireAuth: true });
		const parentId = ctx.query.parentId === undefined ? null : ctx.query.parentId || null;
		const editingCommentId = ctx.query.editingCommentId === undefined ? null : ctx.query.editingCommentId || null;
		const draft = await CommentEndpoints.#manager().getDraft(commentCtx, {
			targetType: TARGET_TYPE,
			targetId: articleSlug,
			parentId,
			editingCommentId,
		});
		return { draft };
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/learning/articles/:slug/comments/draft",
		deferAuth: true,
		options: { rateLimit: DRAFT_RATE_LIMIT, skipIdempotency: true },
	})
	static async saveDraft(ctx: EndpointCtx<SlugParams, DraftBody>) {
		if (!Array.isArray(ctx.data?.blocks)) throw new HttpError(400, "MISSING_FIELDS", "`blocks` requerido");
		const { commentCtx, articleSlug } = await buildArticleResourceCtx(CommentEndpoints.articleModel, ctx, { requireAuth: true });
		return CommentEndpoints.#manager().saveDraft(
			commentCtx,
			{
				targetType: TARGET_TYPE,
				targetId: articleSlug,
				parentId: ctx.data.parentId ?? null,
				editingCommentId: ctx.data.editingCommentId ?? null,
			},
			{ blocks: ctx.data.blocks, attachmentIds: ctx.data.attachmentIds }
		);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/learning/articles/:slug/comments/draft",
		deferAuth: true,
		options: { skipIdempotency: true },
	})
	static async deleteDraft(ctx: EndpointCtx<SlugParams>) {
		const { commentCtx, articleSlug } = await buildArticleResourceCtx(CommentEndpoints.articleModel, ctx, { requireAuth: true });
		const parentId = ctx.query.parentId === undefined ? null : ctx.query.parentId || null;
		const editingCommentId = ctx.query.editingCommentId === undefined ? null : ctx.query.editingCommentId || null;
		await CommentEndpoints.#manager().deleteDraft(commentCtx, {
			targetType: TARGET_TYPE,
			targetId: articleSlug,
			parentId,
			editingCommentId,
		});
		return { ok: true };
	}
}
