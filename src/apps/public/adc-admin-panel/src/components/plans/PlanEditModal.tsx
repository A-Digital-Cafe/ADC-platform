import { useCallback, useState } from "react";
import type { AdminPlan, FeatureDef, UpdatePlanInput } from "../../utils/plans-api.ts";
import { FeatureMapEditor } from "./FeatureMapEditor.tsx";
import { parseTextMap, toTextMap } from "./plan-values.ts";

interface Props {
	readonly plan: AdminPlan;
	/** Catálogo de features registradas: nombres legibles y agrupación por aplicación. */
	readonly defs: readonly FeatureDef[];
	readonly onClose: () => void;
	readonly onSubmit: (patch: UpdatePlanInput) => void;
}

const INTEGER = /^-?\d+$/;
const FEATURES_HELP = 'Valores: número (-1 = sin tope), true/false, texto para las enum, o {"base":10,"perSeat":2} para escalar con los asientos.';

/** Edición de un plan: precio de lista, asientos incluidos y los mapas de features. */
export function PlanEditModal({ plan, defs, onClose, onSubmit }: Props) {
	const isOrg = plan.axis === "org";
	const [forSale, setForSale] = useState(!!plan.price);
	const [currency, setCurrency] = useState(plan.price?.currency ?? "USD");
	const [amount, setAmount] = useState(plan.price ? String(plan.price.unitAmountMinor) : "");
	const [perSeat, setPerSeat] = useState(!!plan.price?.perSeat);
	const [seats, setSeats] = useState(plan.includedSeats === undefined ? "" : String(plan.includedSeats));
	const [features, setFeatures] = useState(() => toTextMap(plan.features));
	const [memberFeatures, setMemberFeatures] = useState(() => toTextMap(plan.memberFeatures));

	const modalRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcClose", onClose);
		},
		[onClose]
	);

	const parsedFeatures = parseTextMap(features);
	const parsedMembers = parseTextMap(memberFeatures);
	const invalid = [...parsedFeatures.invalid, ...parsedMembers.invalid];
	const priceOk = !forSale || (/^[A-Za-z]{3}$/.test(currency.trim()) && INTEGER.test(amount.trim()) && Number(amount) >= 0);
	const seatsOk = !seats.trim() || (INTEGER.test(seats.trim()) && Number(seats) >= -1);

	const submit = (e: { preventDefault(): void }) => {
		e.preventDefault();
		const patch: UpdatePlanInput = { features: parsedFeatures.values };
		// `null` explícito = sacar de venta. Omitir la clave significaría "no toques el precio",
		// que es un caso distinto: por eso el objeto no se arma con spreads de undefined.
		patch.price = forSale ? { currency: currency.trim().toUpperCase(), unitAmountMinor: Number(amount), ...(isOrg && { perSeat }) } : null;
		if (isOrg && seats.trim()) patch.includedSeats = Number(seats);
		if (isOrg && Object.keys(parsedMembers.values).length > 0) patch.memberFeatures = parsedMembers.values;
		onSubmit(patch);
	};

	return (
		<adc-modal ref={modalRef} open modalTitle={`Editar plan ${plan.axis}:${plan.tier}`} size="lg">
			<form onSubmit={submit} className="flex flex-col gap-4">
				<adc-callout tone="warning" role="alert">
					Al guardar, el plan queda <strong>congelado frente a los defaults del código</strong> (<code>seeded: false</code>): los próximos
					arranques ya no lo re-siembran, ni siquiera cuando un módulo registre features nuevas.
				</adc-callout>

				<section className="flex flex-col gap-2">
					<h3 className="text-sm font-medium text-text">Precio de lista</h3>
					<label className="flex items-center gap-2 text-sm text-text">
						<input type="checkbox" checked={forSale} onChange={(e) => setForSale(e.target.checked)} />
						A la venta (destildar lo saca de venta: se borra el precio publicado)
					</label>
					{forSale && (
						<div className="flex flex-wrap items-center gap-2">
							<div className="w-24">
								<adc-input value={currency} maxLength={3} placeholder="USD" onInput={(e: any) => setCurrency(e.target.value)} />
							</div>
							<div className="w-40">
								<adc-input
									value={amount}
									inputMode="numeric"
									placeholder="Centavos (1999)"
									invalid={!priceOk}
									onInput={(e: any) => setAmount(e.target.value)}
								/>
							</div>
							<span className="text-xs text-muted">Unidades menores enteras: 1999 = 19,99.</span>
							{isOrg && (
								<label className="flex items-center gap-2 text-sm text-text">
									<input type="checkbox" checked={perSeat} onChange={(e) => setPerSeat(e.target.checked)} />
									El monto se cobra por asiento
								</label>
							)}
						</div>
					)}
				</section>

				{isOrg && (
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium text-text">Asientos incluidos sin suscripción (-1 = sin tope)</span>
						<div className="w-40">
							<adc-input value={seats} inputMode="numeric" placeholder="3" invalid={!seatsOk} onInput={(e: any) => setSeats(e.target.value)} />
						</div>
					</label>
				)}

				<FeatureMapEditor
					label="Features del plan"
					help={FEATURES_HELP}
					values={features}
					invalid={parsedFeatures.invalid}
					defs={defs}
					onChange={setFeatures}
				/>

				{isOrg && (
					<FeatureMapEditor
						label="Tope por miembro (memberFeatures)"
						help="Lo máximo que un miembro puede consumir del pool compartido si no tiene una excepción propia."
						values={memberFeatures}
						invalid={parsedMembers.invalid}
						defs={defs}
						onChange={setMemberFeatures}
					/>
				)}

				{invalid.length > 0 && (
					<adc-callout tone="error" role="alert">
						Valores que no se pueden interpretar: <code>{invalid.join(", ")}</code>.
					</adc-callout>
				)}

				<div slot="footer" className="flex justify-end gap-2">
					<adc-button variant="accent-outlined" type="button" label="Cancelar" onClick={onClose} />
					<adc-button variant="primary" type="submit" label="Guardar plan" disabled={!priceOk || !seatsOk || invalid.length > 0} />
				</div>
			</form>
		</adc-modal>
	);
}
