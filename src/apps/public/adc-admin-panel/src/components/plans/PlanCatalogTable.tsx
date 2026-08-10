import type { AdminPlan } from "../../utils/plans-api.ts";
import { formatPrice } from "./plan-values.ts";

interface Props {
	readonly plans: readonly AdminPlan[];
	readonly keyOf: (plan: AdminPlan) => string;
	readonly busy: string | null;
	readonly onEdit: (plan: AdminPlan) => void;
	readonly onReset: (plan: AdminPlan) => void;
}

const COLUMNS = ["Eje", "Tier", "Precio", "Asientos incl.", "Features", "Acciones"];

/** Tabla cruda del catálogo: una fila por plan (eje/tier) con sus dos acciones. */
export function PlanCatalogTable({ plans, keyOf, busy, onEdit, onReset }: Props) {
	return (
		<div className="overflow-x-auto">
			<table className="w-full border-collapse text-sm">
				<thead>
					<tr className="border-b border-divider text-left">
						{COLUMNS.map((c) => (
							<th key={c} className="py-2 pr-3 font-medium">
								{c}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{plans.map((plan) => (
						<tr key={keyOf(plan)} className="border-b border-divider/50 align-top">
							<td className="py-2 pr-3">{plan.axis}</td>
							<td className="py-2 pr-3 font-mono">{plan.tier}</td>
							<td className="py-2 pr-3 whitespace-nowrap">
								{plan.price ? (
									formatPrice(plan.price)
								) : (
									<adc-badge color="gray" size="sm">
										fuera de venta
									</adc-badge>
								)}
							</td>
							<td className="py-2 pr-3">{plan.includedSeats ?? "—"}</td>
							<td className="py-2 pr-3 text-muted">
								{Object.keys(plan.features).length}
								{plan.memberFeatures ? ` (+${Object.keys(plan.memberFeatures).length} por miembro)` : ""}
							</td>
							<td className="py-2 pr-3">
								<div className="flex gap-2">
									<adc-button size="small" variant="accent-outlined" label="Editar" disabled={busy === keyOf(plan)} onClick={() => onEdit(plan)} />
									<adc-button size="small" variant="danger" label="Resetear" disabled={busy === keyOf(plan)} onClick={() => onReset(plan)} />
								</div>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
