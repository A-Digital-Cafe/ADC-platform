import { useCallback } from "react";
import type { AdminPlan } from "../../utils/plans-api.ts";

interface Props {
	readonly plan: AdminPlan;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
}

/** Confirmación del reset: es la operación que más se puede llevar puesta sin querer. */
export function PlanResetModal({ plan, onClose, onConfirm }: Props) {
	const modalRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcClose", onClose);
		},
		[onClose]
	);

	return (
		<adc-modal ref={modalRef} open modalTitle={`Resetear ${plan.axis}:${plan.tier}`} size="sm">
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted">
					El plan vuelve a los defaults del código: el seed de plataforma más los defaults de los módulos cargados{" "}
					<strong>en este proceso</strong> (los de un módulo apagado se re-aplican recién cuando arranque).
				</p>
				<adc-callout tone="warning" role="alert">
					También se descarta la oferta importada, <strong>incluido el precio</strong>: el plan queda fuera de venta hasta volver a publicar
					la oferta comercial.
				</adc-callout>
				<div slot="footer" className="flex justify-end gap-2">
					<adc-button variant="accent-outlined" type="button" label="Cancelar" onClick={onClose} />
					<adc-button variant="danger" type="button" label="Resetear a los defaults" onClick={onConfirm} />
				</div>
			</div>
		</adc-modal>
	);
}
