import type { Block } from "@common/ADC/types/learning.ts";
import type { Block as StencilBlock } from "@ui-library/utils/react-jsx";

export interface TransitionCommentSubmitDetail {
	blocks: Block[];
	attachmentIds: string[];
}

interface Props {
	open: boolean;
	submitting?: boolean;
	fromColumn?: string;
	toColumn?: string;
	helperText?: string;
	modalTitle?: string;
	onCancel: () => void;
	onSubmit: (detail: TransitionCommentSubmitDetail) => void;
	onRequestAttachment?: (kind: "image" | "file") => void;
}

const DEFAULT_HELPER = "Esta transición requiere dejar un comentario para documentar la razón. Será visible para el equipo.";

/**
 * Modal específico de PM para transiciones que requieren comentario.
 * Compone primitives genéricos `<adc-modal>` + `<adc-comment-form>`.
 */
export function TransitionCommentModal({
	open,
	submitting = false,
	fromColumn,
	toColumn,
	helperText = DEFAULT_HELPER,
	modalTitle = "Comentario requerido",
	onCancel,
	onSubmit,
	onRequestAttachment,
}: Props) {
	if (!open) return null;
	return (
		<adc-modal open modalTitle={modalTitle} size="lg" onadcClose={onCancel}>
			<div className="flex flex-col gap-3 p-4">
				{(fromColumn || toColumn) && (
					<p className="text-sm text-muted">
						Transición:&nbsp;
						{fromColumn && <span className="font-mono">{fromColumn}</span>}
						{fromColumn && toColumn && <span> → </span>}
						{toColumn && <span className="font-mono">{toColumn}</span>}
					</p>
				)}
				<p className="text-sm">{helperText}</p>
				<adc-comment-form
					submitting={submitting}
					submitLabel="Confirmar y comentar"
					showCancel
					placeholder="Razón de la transición..."
					onadcSubmit={(ev) => {
						const d = ev.detail;
						onSubmit({
							blocks: d.blocks as Block[],
							attachmentIds: d.attachmentIds,
						});
					}}
					onadcCancel={onCancel}
					onadcRequestAttachment={(ev: CustomEvent<{ kind: "image" | "file" }>) => {
						onRequestAttachment?.(ev.detail.kind);
					}}
					initialBlocks={[] as StencilBlock[]}
				/>
			</div>
		</adc-modal>
	);
}
