import type { Model } from "mongoose";
import type { Article } from "../../../../common/ADC/types/learning.js";
import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { HttpError } from "@common/types/ADCCustomError.ts";
import type { AttachmentsManager } from "../../../../utilities/attachments/attachments-utility/index.js";
import { buildArticleResourceCtx } from "./utils/articleResourceCtx.ts";

interface SlugParams {
	slug: string;
}
interface SlugAttParams {
	slug: string;
	attachmentId: string;
}

interface PresignBody {
	fileName: string;
	mimeType: string;
	size: number;
	forComment?: boolean;
}

const ATT_RATE_LIMIT = { max: 30, timeWindow: 60_000 };

export class ArticleAttachmentEndpoints {
	static #articleModel: Model<Article>;
	static #attachmentsManager: AttachmentsManager | null = null;

	static init(articleModel: Model<Article>, attachmentsManager: AttachmentsManager): void {
		ArticleAttachmentEndpoints.#articleModel ??= articleModel;
		ArticleAttachmentEndpoints.#attachmentsManager ??= attachmentsManager;
	}

	static get articleModel(): Model<Article> {
		return ArticleAttachmentEndpoints.#articleModel;
	}

	static #manager(): AttachmentsManager {
		if (!ArticleAttachmentEndpoints.#attachmentsManager) {
			throw new HttpError(503, "ATTACHMENTS_UNAVAILABLE", "Adjuntos no disponibles");
		}
		return ArticleAttachmentEndpoints.#attachmentsManager;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/learning/articles/:slug/attachments",
		deferAuth: true,
		options: { rateLimit: { max: 25, timeWindow: 5_000 } },
	})
	static async list(ctx: EndpointCtx<SlugParams>) {
		const { attachmentCtx, articleSlug } = await buildArticleResourceCtx(ArticleAttachmentEndpoints.articleModel, ctx);
		const includePending = ctx.query.includePending === "true";
		const limit = ctx.query.limit ? Number(ctx.query.limit) : undefined;
		return ArticleAttachmentEndpoints.#manager().listByOwner(attachmentCtx, "article", articleSlug, { includePending, limit });
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/learning/articles/:slug/attachments/presign-upload",
		deferAuth: true,
		options: { rateLimit: ATT_RATE_LIMIT },
	})
	static async presign(ctx: EndpointCtx<SlugParams, PresignBody>) {
		if (!ctx.data?.fileName || !ctx.data?.mimeType || !Number.isFinite(ctx.data?.size)) {
			throw new HttpError(400, "MISSING_FIELDS", "fileName, mimeType y size requeridos");
		}
		const { attachmentCtx, articleSlug } = await buildArticleResourceCtx(ArticleAttachmentEndpoints.articleModel, ctx, {
			requireAuth: true,
		});
		const ownerType = ctx.data.forComment ? "article-comment" : "article";
		return ArticleAttachmentEndpoints.#manager().presignUpload(attachmentCtx, {
			ownerType,
			ownerId: articleSlug,
			fileName: ctx.data.fileName,
			mimeType: ctx.data.mimeType,
			size: ctx.data.size,
		});
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/learning/articles/:slug/attachments/:attachmentId/confirm",
		deferAuth: true,
		options: { rateLimit: ATT_RATE_LIMIT },
	})
	static async confirm(ctx: EndpointCtx<SlugAttParams>) {
		const { attachmentCtx } = await buildArticleResourceCtx(ArticleAttachmentEndpoints.articleModel, ctx, { requireAuth: true });
		return ArticleAttachmentEndpoints.#manager().confirmUpload(attachmentCtx, ctx.params.attachmentId);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/learning/articles/:slug/attachments/:attachmentId/download",
		deferAuth: true,
		options: { rateLimit: { max: 25, timeWindow: 10_000 } },
	})
	static async download(ctx: EndpointCtx<SlugAttParams>) {
		const { attachmentCtx } = await buildArticleResourceCtx(ArticleAttachmentEndpoints.articleModel, ctx);
		const inline = ctx.query.inline === "true";
		const ttl = ctx.query.ttl ? Number(ctx.query.ttl) : undefined;
		return ArticleAttachmentEndpoints.#manager().getDownloadUrl(attachmentCtx, ctx.params.attachmentId, { inline, ttl });
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/learning/articles/:slug/attachments/:attachmentId",
		deferAuth: true,
		options: { rateLimit: ATT_RATE_LIMIT },
	})
	static async remove(ctx: EndpointCtx<SlugAttParams>) {
		const { attachmentCtx } = await buildArticleResourceCtx(ArticleAttachmentEndpoints.articleModel, ctx, { requireAuth: true });
		await ArticleAttachmentEndpoints.#manager().delete(attachmentCtx, ctx.params.attachmentId);
		return { ok: true };
	}
}
