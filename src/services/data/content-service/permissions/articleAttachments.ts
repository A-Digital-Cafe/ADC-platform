/**
 * Permission checker para attachments de artículos (artículos y comentarios).
 */
import type { AttachmentPermissionChecker } from "../../../../utilities/attachments/attachments-utility/index.js";
import { canModerateSocial } from "../utils/community-perms.js";

export interface ArticleAttachmentEndpointCtx {
	userId: string;
	articleSlug: string;
	articleAuthorId?: string | null;
	articleListed: boolean;
	userPermissions: string[];
}

/**
 * Reglas:
 * - `read`: cualquiera (los artículos son públicos por defecto).
 * - `upload`: usuario autenticado (cualquiera puede subir adjuntos para
 *   referenciar en su comentario; el autor del artículo siempre puede).
 * - `delete`: uploader, autor del artículo o moderador social.
 */
export const articleAttachmentsChecker: AttachmentPermissionChecker = (action, ctx, attachment) => {
	const c = ctx as ArticleAttachmentEndpointCtx;
	const isModerator = canModerateSocial({ id: c.userId, permissions: c.userPermissions });
	const isArticleAuthor = !!c.articleAuthorId && c.articleAuthorId === c.userId;

	switch (action) {
		case "read":
			return true;
		case "upload":
			return !!c.userId;
		case "delete":
			if (!attachment) return false;
			return attachment.uploadedBy === c.userId || isArticleAuthor || isModerator;
		default:
			return false;
	}
};
