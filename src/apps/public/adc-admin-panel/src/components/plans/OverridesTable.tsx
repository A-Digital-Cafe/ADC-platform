import { useMemo } from "react";
import type { FeatureDef, PlanOverrideDto } from "../../utils/plans-api.ts";
import { featureLabel } from "./feature-labels.ts";

interface Props {
	readonly rows: readonly PlanOverrideDto[];
	/** Catálogo de features: pone nombre legible arriba de la clave. Puede venir vacío. */
	readonly defs: readonly FeatureDef[];
	readonly busy: string | null;
	readonly onRemove: (override: PlanOverrideDto) => void;
}

const COLUMNS = ["Sujeto", "Feature", "Valor", "Organización", "Creada por", "Actualizada", ""];

/** Tabla cruda de excepciones de límite. */
export function OverridesTable({ rows, defs, busy, onRemove }: Props) {
	const names = useMemo(() => new Map(defs.map((def) => [def.key, featureLabel(def)])), [defs]);
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
					{rows.map((o) => (
						<tr key={o.id} className="border-b border-divider/50 align-top">
							<td className="py-2 pr-3 font-mono break-all">
								{o.subjectType}:{o.subjectId}
							</td>
							<td className="py-2 pr-3 break-all">
								{names.has(o.featureKey) && <p className="text-text">{names.get(o.featureKey)}</p>}
								<p className="font-mono text-xs text-muted">{o.featureKey}</p>
							</td>
							<td className="py-2 pr-3 whitespace-nowrap">
								{String(o.value)}
								{o.value === -1 && (
									<adc-badge color="purple" size="sm">
										sin tope
									</adc-badge>
								)}
							</td>
							<td className="py-2 pr-3 font-mono break-all text-muted">{o.orgId ?? "global"}</td>
							<td className="py-2 pr-3 font-mono break-all text-muted">{o.createdBy}</td>
							<td className="py-2 pr-3 whitespace-nowrap text-muted">{new Date(o.updatedAt).toLocaleString()}</td>
							<td className="py-2 pr-3">
								<adc-button size="small" variant="danger" label="Quitar" disabled={busy === o.id} onClick={() => onRemove(o)} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
