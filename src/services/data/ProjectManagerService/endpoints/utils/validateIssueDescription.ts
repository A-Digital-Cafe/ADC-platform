import type ProjectManagerService from "../../index.js";
import type { IssueAttachmentEndpointCtx } from "../../permissions/issueAttachments.ts";
import type { Block } from "@common/ADC/types/learning.ts";
import { sanitizeBlocks, extractAttachmentIdsFromBlocks } from "@common/utils/blocks/sanitize.ts";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import { ISSUE_DESCRIPTION_MAX_BLOCKS } from "../../dao/issues.ts";

/** Máximo de adjuntos referenciables desde una descripción de issue. */
export const ISSUE_DESCRIPTION_MAX_ATTACHMENTS = 10;

/**
 * Sanitiza blocks de descripción de issue y valida que los adjuntos referenciados
 * existan, sean accesibles al caller y le pertenezcan (uploader). Mantiene paridad
 * de seguridad con `CommentsManager.#validateAttachments` para que las reglas
 * org/permission/uploader coincidan entre comments y descripciones.
 */
export async function validateAndSanitizeIssueDescription(
	service: ProjectManagerService,
	attachmentCtx: IssueAttachmentEndpointCtx,
	rawBlocks: unknown
): Promise<Block[]> {
	const blocks = sanitizeBlocks(rawBlocks, { maxBlocks: ISSUE_DESCRIPTION_MAX_BLOCKS });
	const attachmentIds = extractAttachmentIdsFromBlocks(blocks);
	if (!attachmentIds.length) return blocks;
	if (attachmentIds.length > ISSUE_DESCRIPTION_MAX_ATTACHMENTS) {
		throw new ProjectManagerError(
			400,
			"ISSUE_DESCRIPTION_TOO_MANY_ATTACHMENTS",
			`Máximo ${ISSUE_DESCRIPTION_MAX_ATTACHMENTS} adjuntos por descripción`
		);
	}
	const found = await service.issueAttachments.getMany(attachmentCtx as any, attachmentIds);
	if (found.length !== attachmentIds.length) {
		throw new ProjectManagerError(400, "ISSUE_DESCRIPTION_BAD_ATTACHMENT", "Adjunto inválido o no autorizado");
	}
	for (const att of found) {
		if (att.uploadedBy !== attachmentCtx.userId) {
			throw new ProjectManagerError(403, "ISSUE_DESCRIPTION_ATTACHMENT_NOT_OWNED", "Solo puedes referenciar adjuntos que subiste");
		}
	}
	return blocks;
}
