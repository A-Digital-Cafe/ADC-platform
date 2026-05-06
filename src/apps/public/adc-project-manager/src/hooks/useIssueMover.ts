import { useCallback, useState } from "react";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Block } from "@common/ADC/types/learning.ts";
import type { Block as StencilBlock } from "@ui-library/utils/react-jsx";
import type { TransitionCommentSubmitDetail } from "../components/TransitionCommentModal.tsx";
import { pmApi } from "../utils/pm-api.ts";

interface PendingMove {
	issueId: string;
	fromColumn: string;
	toColumn: string;
}

interface UseIssueMoverOpts {
	project: Project;
	onSuccess: () => void | Promise<void>;
	onFailure?: () => void | Promise<void>;
}

interface UseIssueMoverResult {
	pendingMove: PendingMove | null;
	requestMove: (issueId: string, fromColumn: string, toColumn: string, reason?: string) => Promise<void>;
	cancelMove: () => void;
	confirmMoveWithComment: (detail: TransitionCommentSubmitDetail) => Promise<void>;
	moving: boolean;
}

/**
 * Hook que gestiona el flujo de mover issue:
 * - Llama directamente a `moveIssue` si la columna destino no es final o si el proyecto no requiere comentario.
 * - Si la transición requiere comentario, expone `pendingMove` para que el caller renderice
 *   `<adc-transition-comment-modal>` y maneje `confirmMoveWithComment`.
 */
export function useIssueMover({ project, onSuccess, onFailure }: UseIssueMoverOpts): UseIssueMoverResult {
	const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
	const [moving, setMoving] = useState(false);

	const requireComment = project.settings?.requireCommentOnFinalTransition === true;

	const isFinal = useCallback(
		(columnKey: string) => project.kanbanColumns.find((c) => c.key === columnKey)?.isDone === true,
		[project.kanbanColumns]
	);

	const requestMove = useCallback(
		async (issueId: string, fromColumn: string, toColumn: string, reason?: string) => {
			if (fromColumn === toColumn) return;
			if (requireComment && isFinal(toColumn)) {
				setPendingMove({ issueId, fromColumn, toColumn });
				return;
			}
			setMoving(true);
			try {
				const res = await pmApi.moveIssue(issueId, toColumn, { reason });
				if (res.success) await onSuccess();
				else if (onFailure) await onFailure();
			} finally {
				setMoving(false);
			}
		},
		[isFinal, requireComment, onSuccess, onFailure]
	);

	const cancelMove = useCallback(() => setPendingMove(null), []);

	const confirmMoveWithComment = useCallback(
		async (detail: TransitionCommentSubmitDetail) => {
			if (!pendingMove) return;
			setMoving(true);
			try {
				const res = await pmApi.moveIssue(pendingMove.issueId, pendingMove.toColumn, {
					commentBlocks: detail.blocks as Block[],
					commentAttachmentIds: detail.attachmentIds,
				});
				if (res.success) {
					setPendingMove(null);
					await onSuccess();
				} else if (onFailure) {
					await onFailure();
				}
			} finally {
				setMoving(false);
			}
		},
		[pendingMove, onSuccess, onFailure]
	);

	return { pendingMove, requestMove, cancelMove, confirmMoveWithComment, moving };
}

export type { PendingMove, StencilBlock };
