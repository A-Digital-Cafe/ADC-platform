import type { Block } from "@common/ADC/types/learning.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";

/**
 * Determina si una transición requiere comentario obligatorio y, en ese caso,
 * valida que el caller haya enviado bloques de comentario.
 *
 * Responsabilidad: shape + reglas declarativas del proyecto. No accede a
 * persistencia ni mutates estado.
 */
export function assertCommentForFinalTransition(project: Project, targetColumnKey: string, commentBlocks: Block[] | undefined): void {
	const targetColumn = project.kanbanColumns.find((c) => c.key === targetColumnKey);
	const isFinal = !!targetColumn?.isDone;
	const requiresComment = isFinal && !!project.settings?.requireCommentOnFinalTransition;
	if (requiresComment && (!commentBlocks || !commentBlocks.length)) {
		throw new ProjectManagerError(400, "COMMENT_REQUIRED_ON_FINAL", "Esta transición requiere un comentario explicando el cierre");
	}
}
