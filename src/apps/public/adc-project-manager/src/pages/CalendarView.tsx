import { useMemo, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { Sprint } from "@common/types/project-manager/Sprint.ts";
import type { Milestone } from "@common/types/project-manager/Milestone.ts";
import type { IssueListParams } from "../utils/pm-api.ts";
import { useBacklogData } from "../hooks/useBacklogData.ts";
import { CalendarGrid } from "../components/calendar/CalendarGrid.tsx";
import { IssueDialog } from "../components/IssueDialog.tsx";

interface Props {
	project: Project;
	perms: Permission[];
}

type RangeType = "sprint" | "milestone";

function pickDefault(entities: Array<{ id: string; status: string }>): string | undefined {
	const active = entities.find((e) => e.status === "active");
	if (active) return active.id;
	return entities[0]?.id;
}

export function CalendarView({ project, perms }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [rangeType, setRangeType] = useState<RangeType>("sprint");
	const [entityId, setEntityId] = useState<string | undefined>();
	const [editingIssue, setEditingIssue] = useState<Issue | null>(null);

	const { issues, sprints, milestones, loading, reload } = useBacklogData({
		projectId: project.id,
		q: "",
		orderBy: "priority" as IssueListParams["orderBy"],
	});

	const entities: Array<Sprint | Milestone> = rangeType === "sprint" ? sprints : milestones;
	const activeId = entityId ?? pickDefault(entities);
	const entity = entities.find((e) => e.id === activeId);

	const relevantIssues = useMemo(() => {
		if (!entity) return [];
		return issues.filter((i) => (rangeType === "sprint" ? i.sprintId === entity.id : i.milestoneId === entity.id));
	}, [issues, entity, rangeType]);

	const entityOptions = JSON.stringify(entities.map((e) => ({ label: e.name, value: e.id })));

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-end gap-3">
				<div>
					<label className="block text-xs font-medium mb-1 text-muted">{t("calendar.rangeType")}</label>
					<adc-combobox
						value={rangeType}
						clearable={false}
						options={JSON.stringify([
							{ label: t("issues.sprint"), value: "sprint" },
							{ label: t("issues.milestone"), value: "milestone" },
						])}
						onadcChange={(e: any) => {
							setRangeType(e.detail);
							setEntityId(undefined);
						}}
					/>
				</div>
				<div className="min-w-60">
					<label className="block text-xs font-medium mb-1 text-muted">
						{rangeType === "sprint" ? t("issues.sprint") : t("issues.milestone")}
					</label>
					<adc-combobox
						value={activeId ?? ""}
						clearable={false}
						options={entityOptions}
						onadcChange={(e: any) => setEntityId(e.detail)}
					/>
				</div>
			</div>

			{loading ? (
				<adc-skeleton variant="rectangular" height="400px" />
			) : !entity ? (
				<p className="text-muted text-sm">{t("calendar.noSelection")}</p>
			) : !entity.startDate || !entity.endDate ? (
				<p className="text-muted text-sm">{t("calendar.noDates")}</p>
			) : (
				<CalendarGrid
					project={project}
					issues={relevantIssues}
					startDate={new Date(entity.startDate)}
					endDate={new Date(entity.endDate)}
					onOpen={setEditingIssue}
				/>
			)}

			{editingIssue && (
				<IssueDialog
					project={project}
					issue={editingIssue}
					perms={perms}
					sprints={sprints}
					milestones={milestones}
					onClose={() => setEditingIssue(null)}
					onSaved={async () => {
						setEditingIssue(null);
						await reload();
					}}
				/>
			)}
		</div>
	);
}
