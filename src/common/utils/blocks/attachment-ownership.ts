import { HttpError } from "../../types/ADCCustomError.js";

/**
 * Validación compartida de ownership de adjuntos referenciados desde blocks.
 * Única fuente de la regla "solo puedes referenciar adjuntos que
 * subiste" usada por comments (CommentsUtility) y descripciones de issues.
 */
export function assertOwnedAttachments(options: {
	/** IDs solicitados (de blocks + extra). */
	requestedIds: string[];
	/** Adjuntos efectivamente resueltos por el AttachmentsManager (ya filtrados por scope/permisos). */
	found: Array<{ uploadedBy: string }>;
	/** Usuario autor de la operación. */
	userId: string;
	/** Prefijo del código de error (ej. "COMMENT", "ISSUE_DESCRIPTION"). */
	errorPrefix: string;
}): void {
	const { requestedIds, found, userId, errorPrefix } = options;
	if (found.length !== requestedIds.length) {
		throw new HttpError(400, `${errorPrefix}_BAD_ATTACHMENT`, "Adjunto inválido o no autorizado");
	}
	for (const att of found) {
		if (att.uploadedBy !== userId) {
			throw new HttpError(403, `${errorPrefix}_ATTACHMENT_NOT_OWNED`, "Solo puedes referenciar adjuntos que subiste");
		}
	}
}
