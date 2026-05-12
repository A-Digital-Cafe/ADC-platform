/**
 * Permission checker para avatares de usuarios.
 *
 * Reglas:
 *  - `read`:   público (cualquiera puede ver avatares).
 *  - `upload`: solo el propio usuario.
 *  - `delete`: solo el propio usuario (uploader); el doc Attachment registra
 *              `uploadedBy=userId` y `ownerId=userId`.
 */
import type { AttachmentPermissionChecker } from "../../../../utilities/attachments/attachments-utility/index.js";

export interface UserAvatarEndpointCtx {
	userId: string; // caller
	targetUserId: string; // owner del avatar
}

export const userAvatarAttachmentsChecker: AttachmentPermissionChecker = (action, ctx, attachment) => {
	const c = ctx as UserAvatarEndpointCtx;
	switch (action) {
		case "read":
			return true;
		case "upload":
			return !!c.userId && c.userId === c.targetUserId;
		case "delete":
			if (!c.userId) return false;
			if (attachment) return attachment.uploadedBy === c.userId;
			// sin doc: solo permitir si el caller coincide con el target (lo borrará silenciosamente si no existe)
			return c.userId === c.targetUserId;
		default:
			return false;
	}
};
