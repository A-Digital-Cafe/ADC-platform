import { ACTIONS, ALL_ACTIONS } from "./constants.ts";
import { ResourceHeader } from "./ResourceHeader.tsx";
import type { ScopeDef } from "@common/types/resources.js";

interface ResourceMatrixProps {
	readonly resource: string;
	readonly scopes: ScopeDef[];
	readonly permMap: Map<string, number>;
	readonly onToggle: (resource: string, scope: number, action: number) => void;
	readonly onToggleRow: (resource: string, scope: number) => void;
	readonly onToggleCol: (resource: string, scopes: ScopeDef[], action: number) => void;
	readonly onRemove: (resource: string) => void;
	readonly disabled?: boolean;
	readonly t: (k: string) => string;
}

export function ResourceMatrix({ resource, scopes, permMap, onToggle, onToggleRow, onToggleCol, onRemove, disabled, t }: ResourceMatrixProps) {
	const allActions = ALL_ACTIONS;

	/**
	 * Resuelve la etiqueta de un scope probando primero la subclave específica
	 * del recurso y cayendo al key plano si no existe traducción.
	 *   1) permissions.{resource}.{scope.key}
	 *   2) permissions.{scope.key}
	 *   3) scope.key (último recurso)
	 */
	const scopeLabel = (scopeKey: string): string => {
		const nested = `permissions.${resource}.${scopeKey}`;
		const nestedTr = t(nested);
		if (nestedTr !== nested) return nestedTr;
		const flat = `permissions.${scopeKey}`;
		const flatTr = t(flat);
		if (flatTr !== flat) return flatTr;
		return scopeKey;
	};

	return (
		<div className="border border-accent/50 rounded-xl overflow-hidden">
			<ResourceHeader resource={resource} onRemove={onRemove} disabled={disabled} t={t} />
			<table className="w-full text-xs">
				<thead>
					<tr className="bg-accent/20 border-b border-surface">
						<th className="px-3 py-2 text-left font-heading font-semibold text-text">{t("permissions.scope")}</th>
						{ACTIONS.map((action) => (
							<th key={action.key} className="px-3 py-2 text-center font-heading font-semibold text-text">
								<button
									type="button"
									className="cursor-pointer hover:text-primary transition-colors"
									onClick={() => onToggleCol(resource, scopes, action.value)}
									disabled={disabled}
									title={t("permissions.toggleAll")}
								>
									{t(action.label)}
								</button>
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{scopes.map((scope) => {
						const key = `${resource}:${scope.value}`;
						const rowActions = permMap.get(key) ?? 0;
						const allChecked = rowActions === allActions;
						return (
							<tr key={scope.key} className="border-b border-accent/20 hover:bg-surface/20 transition-colors">
								<td className="px-3 py-2 font-medium text-text">
									<button
										type="button"
										className={`cursor-pointer transition-colors ${allChecked ? "text-primary font-semibold" : "hover:text-primary"}`}
										onClick={() => onToggleRow(resource, scope.value)}
										disabled={disabled}
										title={t("permissions.toggleRow")}
									>
										{scopeLabel(scope.key)}
									</button>
								</td>
								{ACTIONS.map((action) => (
									<td key={action.key} className="px-3 py-2 text-center">
										<adc-checkbox
											checked={((permMap.get(key) ?? 0) & action.value) === action.value}
											disabled={disabled}
											onChange={() => onToggle(resource, scope.value, action.value)}
										/>
									</td>
								))}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
