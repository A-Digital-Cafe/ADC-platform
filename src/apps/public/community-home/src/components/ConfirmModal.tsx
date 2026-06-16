import "@ui-library/utils/react-jsx";
import { useCallback } from "react";

interface ConfirmModalProps {
	/** Título del header (por defecto "Confirmar"). */
	readonly title?: string;
	readonly message: string;
	/** Texto del botón de confirmación (por defecto "Eliminar"). */
	readonly confirmLabel?: string;
	/** Variante `danger` en el botón de confirmación (default true). */
	readonly danger?: boolean;
	/** Deshabilita los botones y el cierre mientras corre la acción. */
	readonly busy?: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
}

/** Confirmación con `adc-modal` de la UI library (reemplaza a `globalThis.confirm`). */
export function ConfirmModal({ title = "Confirmar", message, confirmLabel = "Eliminar", danger = true, busy = false, onClose, onConfirm }: Readonly<ConfirmModalProps>) {
	// adc-modal emite `adcClose` al cerrarse por backdrop/escape/✕.
	const ref = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcClose", onClose);
		},
		[onClose]
	);

	return (
		<adc-modal ref={ref} open modalTitle={title} size="sm" dismissOnBackdrop={!busy} dismissOnEscape={!busy}>
			<p className="text-text">{message}</p>
			<div slot="footer" className="flex justify-end gap-2">
				<adc-button variant="accent-outlined" size="small" label="Cancelar" disabled={busy} onClick={onClose} />
				<adc-button variant={danger ? "danger" : "primary"} size="small" label={confirmLabel} disabled={busy} onClick={onConfirm} />
			</div>
		</adc-modal>
	);
}
