import type { Model } from "mongoose";
import { HttpError } from "@common/types/ADCCustomError.ts";
import type { EndpointCtx } from "../../../../core/EndpointManagerService/index.js";
import type { Article } from "../../../../../common/ADC/types/learning.js";
import type { ArticleCommentEndpointCtx } from "../../permissions/articleComments.ts";
import type { ArticleAttachmentEndpointCtx } from "../../permissions/articleAttachments.ts";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import { resolveUserAvatar } from "@common/utils/avatar.ts";

export interface ArticleResourceCtxResult {
	articleSlug: string;
	articleAuthorId: string | null;
	articleListed: boolean;
	commentCtx: ArticleCommentEndpointCtx;
	attachmentCtx: ArticleAttachmentEndpointCtx;
}

/**
 * Resuelve los datos del artículo y construye los contextos enriquecidos para
 * los `permissionChecker` de comentarios y adjuntos.
 *
 * Si `requireAuth` es `true`, exige `ctx.user` y lanza 401 si falta.
 */
export async function buildArticleResourceCtx(
	articleModel: Model<Article>,
	ctx: EndpointCtx<{ slug: string }>,
	opts: { requireAuth?: boolean; requireListed?: boolean } = {}
): Promise<ArticleResourceCtxResult> {
	const slug = ctx.params.slug;
	if (!slug) throw new HttpError(400, "MISSING_FIELDS", "`slug` requerido");

	const article = await articleModel.findOne({ slug }).select("slug listed authorId").lean();
	if (!article) throw new HttpError(404, "ARTICLE_NOT_FOUND", "Artículo no encontrado");
	if (opts.requireListed && !article.listed) {
		throw new HttpError(404, "ARTICLE_NOT_FOUND", "Artículo no encontrado");
	}

	if (opts.requireAuth && !ctx.user) {
		throw new AuthError(401, "UNAUTHORIZED", "Authentication required");
	}

	const userId = ctx.user?.id ?? "";
	const authorName = ctx.user?.username;
	const authorImage = resolveUserAvatar(ctx.user as { metadata?: Record<string, unknown> } | undefined);

	const base = {
		userId,
		articleSlug: slug,
		articleAuthorId: article.authorId ?? null,
		articleListed: !!article.listed,
		userPermissions: ctx.user?.permissions ?? [],
	};
	const commentCtx: ArticleCommentEndpointCtx = { ...base, authorName, authorImage };
	const attachmentCtx: ArticleAttachmentEndpointCtx = base;

	return { ...base, commentCtx, attachmentCtx };
}
