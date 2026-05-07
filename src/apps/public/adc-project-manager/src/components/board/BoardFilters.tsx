import type { ReactNode } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Sprint } from "@common/types/project-manager/Sprint.ts";
import type { Milestone } from "@common/types/project-manager/Milestone.ts";

export interface BoardFilterState {
	sprintId?: string;
	milestoneId?: string;
	assigneeId?: string;
}

interface Props {
	q: string;
	onQChange: (v: string) => void;
	filters: BoardFilterState;
	onFiltersChange: (v: BoardFilterState) => void;
	sprints: Sprint[];
	milestones: Milestone[];
	trailing?: ReactNode;
}

export function BoardFilters({ q, onQChange, filters, onFiltersChange, sprints, milestones, trailing }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });

	const sprintOptions = JSON.stringify([
		{ label: t("issues.unassigned"), value: "" },
		...sprints.map((s) => ({ label: s.name, value: s.id })),
	]);
	const milestoneOptions = JSON.stringify([
		{ label: t("issues.unassigned"), value: "" },
		...milestones.map((m) => ({ label: m.name, value: m.id })),
	]);

	return (
		<div className="flex flex-wrap items-end gap-2">
			<div className="flex-1 min-w-60 max-w-100">
				<label className="block text-xs font-medium mb-1 text-muted">{t("issues.searchPlaceholder")}</label>
				<adc-input value={q} placeholder={t("common.search")} onInput={(e: any) => onQChange(e.target.value)} />
			</div>
			<div>
				<label className="block text-xs font-medium mb-1 text-muted">{t("issues.sprint")}</label>
				<adc-combobox
					value={filters.sprintId ?? ""}
					clearable
					options={sprintOptions}
					onadcChange={(e: any) => onFiltersChange({ ...filters, sprintId: e.detail || undefined })}
				/>
			</div>
			<div>
				<label className="block text-xs font-medium mb-1 text-muted">{t("issues.milestone")}</label>
				<adc-combobox
					value={filters.milestoneId ?? ""}
					clearable
					options={milestoneOptions}
					onadcChange={(e: any) => onFiltersChange({ ...filters, milestoneId: e.detail || undefined })}
				/>
			</div>
			{trailing && <div className="ml-auto">{trailing}</div>}
		</div>
	);
}
