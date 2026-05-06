import type { Model } from "mongoose";
import type { Article, LearningPath, Block } from "../../../../common/ADC/types/learning.js";
import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { HttpError } from "@common/types/ADCCustomError.ts";
import { P } from "@common/types/Permissions.ts";
import { buildArticleListPipeline } from "../utils/article-query.js";
import { canPublish, isOwner } from "../utils/community-perms.js";

interface CreateArticleBody {
	slug: string;
	title: string;
	pathSlug?: string;
	blocks?: Block[];
	videoUrl?: string;
	image?: { url: string; width?: number; height?: number; alt?: string };
	authorId?: string;
	listed?: boolean;
	description?: string;
}

interface UpdateArticleBody {
	title?: string;
	pathSlug?: string;
	blocks?: Block[];
	videoUrl?: string;
	image?: { url: string; width?: number; height?: number; alt?: string };
	listed?: boolean;
	description?: string;
}

interface SlugParams {
	slug: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/;

export class ArticleEndpoints {
	private static model: Model<Article>;
	private static pathModel: Model<LearningPath>;

	static init(model: Model<any>, pathModel: Model<any>) {
		ArticleEndpoints.model ??= model;
		ArticleEndpoints.pathModel ??= pathModel;
	}

	@RegisterEndpoint({ method: "GET", url: "/api/learning/articles" })
	static async list(ctx: EndpointCtx): Promise<{ articles: Article[]; total: number; start: number; limit: number }> {
		return buildArticleListPipeline(ArticleEndpoints.model, ArticleEndpoints.pathModel, ctx.query as any);
	}

	@RegisterEndpoint({ method: "GET", url: "/api/learning/articles/:slug" })
	static async getBySlug(ctx: EndpointCtx<SlugParams>): Promise<{ article: Article }> {
		const { slug } = ctx.params;
		const doc = await ArticleEndpoints.model.findOne({ slug }).lean();
		if (!doc) throw new HttpError(404, "ARTICLE_NOT_FOUND", "Article not found");
		return { article: doc as Article };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/learning/articles",
		permissions: [P.COMMUNITY.CONTENT.WRITE],
		options: { rateLimit: { max: 4, timeWindow: 3_600_000 } },
	})
	static async create(ctx: EndpointCtx<Record<string, string>, CreateArticleBody>): Promise<{ article: Article }> {
		const data = ctx.data;
		const user = ctx.user;
		if (!data.slug || !data.title) throw new HttpError(400, "MISSING_FIELDS", "slug and title are required");
		if (!SLUG_RE.test(data.slug)) throw new HttpError(400, "INVALID_SLUG", "Invalid slug format");

		const authorId = user?.id ?? data.authorId;
		if (!authorId) throw new HttpError(400, "MISSING_AUTHOR", "authorId is required");

		const allowPublish = canPublish(user);
		const listed = allowPublish ? (data.listed ?? false) : false;

		try {
			const doc = await ArticleEndpoints.model.create({ ...data, authorId, listed });
			return { article: doc.toObject() as Article };
		} catch (err: any) {
			if (err?.code === 11000) throw new HttpError(409, "SLUG_TAKEN", "Slug already exists");
			throw err;
		}
	}

	@RegisterEndpoint({ method: "PUT", url: "/api/learning/articles/:slug", permissions: [P.COMMUNITY.CONTENT.WRITE] })
	static async update(ctx: EndpointCtx<SlugParams, UpdateArticleBody>): Promise<{ article: Article }> {
		const { slug } = ctx.params;
		const user = ctx.user;
		const existing = await ArticleEndpoints.model.findOne({ slug }).select("authorId").lean();
		if (!existing) throw new HttpError(404, "ARTICLE_NOT_FOUND", `Article with slug "${slug}" not found`);

		const owner = isOwner(user, existing.authorId);
		const allowPublish = canPublish(user);
		if (!owner && !allowPublish) throw new HttpError(403, "FORBIDDEN", "Not allowed to edit this article");

		const cleanData: Record<string, any> = {};
		for (const [key, value] of Object.entries(ctx.data || {})) {
			if (value === undefined) continue;
			if ((key === "listed" || key === "description") && !allowPublish) continue;
			if (key === "authorId" || key === "slug") continue;
			cleanData[key] = value;
		}

		const doc = await ArticleEndpoints.model.findOneAndUpdate({ slug }, cleanData, { new: true }).lean();
		if (!doc) throw new HttpError(404, "ARTICLE_NOT_FOUND", `Article with slug "${slug}" not found`);
		return { article: doc as Article };
	}

	@RegisterEndpoint({ method: "DELETE", url: "/api/learning/articles/:slug", permissions: [P.COMMUNITY.CONTENT.DELETE] })
	static async delete(ctx: EndpointCtx<SlugParams>): Promise<{ success: boolean }> {
		const { slug } = ctx.params;
		const user = ctx.user;
		const existing = await ArticleEndpoints.model.findOne({ slug }).select("authorId listed").lean();
		if (!existing) throw new HttpError(404, "ARTICLE_NOT_FOUND", `Article with slug "${slug}" not found`);

		const owner = isOwner(user, existing.authorId);
		const allowPublish = canPublish(user);
		if (existing.listed && !allowPublish) throw new HttpError(403, "FORBIDDEN", "Cannot delete a published article");
		if (!owner && !allowPublish) throw new HttpError(403, "FORBIDDEN", "Not allowed to delete this article");

		await ArticleEndpoints.model.deleteOne({ slug });
		return { success: true };
	}
}
