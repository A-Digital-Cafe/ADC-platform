import { useCallback, useState } from "react";
import { LEGAL_REBUILD_MIN_REASON } from "@common/types/legal/index.ts";
import type { LegalDocOverview } from "../../utils/legal-api.ts";

interface Props {
	readonly doc: LegalDocOverview;
	readonly onClose: () => void;
	readonly onConfirm: (reason: string) => void;
}

/**
 * Confirmación de la regeneración de un PDF congelado.
 *
 * Reemplaza al «borrá el archivo a mano en el volumen de despliegue», que era la única forma de
 * hacerlo y no dejaba ni quién ni por qué. El motivo no es burocracia: el archivo es la copia que
 * le queda a quien aceptó, y uno que puede cambiar en silencio no prueba nada.
 */
export function RebuildModal({ doc, onClose, onConfirm }: Props) {
	const [reason, setReason] = useState("");
	const modalRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcClose", onClose);
		},
		[onClose]
	);

	const enough = reason.trim().length >= LEGAL_REBUILD_MIN_REASON;

	return (
		<adc-modal ref={modalRef} open modalTitle={`Rehacer el PDF de ${doc.label}`} size="sm">
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted">
					Se borra <code>{doc.pdf?.file}</code> de este nodo y se vuelve a generar desde el texto desplegado. Los demás nodos conservan el
					suyo.
				</p>
				<adc-callout tone="warning" role="alert">
					Un PDF congelado es la copia que le queda a quien aceptó esta versión. Rehacerlo sólo tiene sentido si el actual salió mal (por
					ejemplo, con los datos del responsable vacíos), <strong>no</strong> para reflejar un cambio de texto: eso es una versión nueva.
				</adc-callout>

				<label className="block">
					<span className="mb-1 block text-sm text-muted">Motivo (queda en el audit log y en el historial)</span>
					<adc-textarea
						value={reason}
						rows={3}
						aria-label="Motivo de la regeneración"
						onInput={(e: { target: unknown }) => setReason((e.target as HTMLTextAreaElement).value)}
					/>
				</label>
				{!enough && <p className="text-xs text-muted">Escribí al menos {LEGAL_REBUILD_MIN_REASON} caracteres.</p>}

				<div slot="footer" className="flex justify-end gap-2">
					<adc-button variant="accent-outlined" type="button" label="Cancelar" onClick={onClose} />
					<adc-button variant="danger" type="button" label="Rehacer el PDF" disabled={!enough} onClick={() => onConfirm(reason.trim())} />
				</div>
			</div>
		</adc-modal>
	);
}
