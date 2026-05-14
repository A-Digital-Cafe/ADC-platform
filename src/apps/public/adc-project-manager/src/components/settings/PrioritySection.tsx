import { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Project, PriorityStrategy, PriorityStrategyId } from "@common/types/project-manager/Project.ts";
import { pmApi } from "../../utils/pm-api.ts";

interface Props {
	project: Project;
	canEdit: boolean;
	onSaved: () => void | Promise<void>;
}

const STRATEGIES: PriorityStrategyId[] = ["matrix-eisenhower", "weighted-sum", "wsjf-like"];

export function PrioritySection({ project, canEdit, onSaved }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [strategy, setStrategy] = useState<PriorityStrategy>(project.priorityStrategy);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const save = async () => {
		setSaving(true);
		setError(null);
		const res = await pmApi.updatePriorityStrategy(project.id, strategy);
		setSaving(false);
		if (!res.success) {
			setError(res.errorKey ?? "error");
			return;
		}
		await onSaved();
	};

	return (
		<div className="space-y-4 max-w-xl">
			<div className="space-y-2">
				{STRATEGIES.map((id) => {
					const inputId = `priority-strategy-${id}`;
					const descriptionId = `priority-strategy-${id}-desc`;
					const label = t(`settings.strategy_${id}`);

					return (
						<label key={id} htmlFor={inputId} aria-label={label} className="flex items-start gap-2 text-sm cursor-pointer">
							<input
								id={inputId}
								type="radio"
								name="priority-strategy"
								checked={strategy.id === id}
								onChange={() => setStrategy({ ...strategy, id })}
								disabled={!canEdit}
								aria-describedby={descriptionId}
								className="mt-0.5"
							/>
							<span>
								<span id={`priority-strategy-${id}-label`} className="font-medium text-text">
									{label}
								</span>
								<span id={descriptionId} className="block text-xs text-muted">
									{t(`settings.strategy_${id}_desc`)}
								</span>
							</span>
						</label>
					);
				})}
			</div>
			{strategy.id === "weighted-sum" && (
				<div className="grid grid-cols-3 gap-2">
					{(["urgency", "importance", "difficulty"] as const).map((k) => (
						<div key={k}>
							<label className="block text-xs text-muted mb-1">{t(`settings.weight_${k}`)}</label>
							<adc-input
								type="number"
								value={String(strategy.weights?.[k] ?? 1)}
								onInput={(e: any) =>
									setStrategy({
										...strategy,
										weights: {
											urgency: 1,
											importance: 1,
											difficulty: 1,
											...strategy.weights,
											[k]: Number(e.target.value) || 0,
										},
									})
								}
								disabled={!canEdit}
							/>
						</div>
					))}
				</div>
			)}
			{error && <p className="text-sm text-tdanger">{error}</p>}
			{canEdit && (
				<adc-button variant="primary" onClick={save} disabled={saving}>
					{t("common.save")}
				</adc-button>
			)}
		</div>
	);
}
