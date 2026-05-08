/**
 * Permission checker para comentarios de artículos.
 */
import type { CommentPermissionChecker } from "../../../../utilities/comments/comments-utility/index.js";
import { canModerateSocial } from "../utils/community-perms.js";

export interface ArticleCommentEndpointCtx {
	userId: string;
	authorName?: string;
	authorImage?: string;
	articleSlug: string;
	articleAuthorId?: string | null;
	articleListed: boolean;
	userPermissions: string[];
}

/**
 * Reglas:
 * - `list`: cualquier usuario autenticado.
 * - `create` / `reply` / `react`: cualquier usuario autenticado en un artículo
 *   publicado (`listed`).
 * - `edit`: solo el autor del comentario.
 * - `delete`: el autor, el autor del artículo o un moderador social.
 * - `moderate`: moderadores sociales o autor del artículo.
 */
export const articleCommentsChecker: CommentPermissionChecker = (action, ctx, comment) => {
	const c = ctx as ArticleCommentEndpointCtx;
	if (!c.userId) return false;
	const isModerator = canModerateSocial({ id: c.userId, permissions: c.userPermissions });
	const isArticleAuthor = !!c.articleAuthorId && c.articleAuthorId === c.userId;

	switch (action) {
		case "list":
			return true;
		case "create":
		case "reply":
		case "react":
			return c.articleListed || isArticleAuthor || isModerator;
		case "edit":
			return !!comment && comment.authorId === c.userId;
		case "delete":
			if (!comment) return false;
			return comment.authorId === c.userId || isArticleAuthor || isModerator;
		case "moderate":
			return isArticleAuthor || isModerator;
		default:
			return false;
	}
};
