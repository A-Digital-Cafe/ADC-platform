import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import { resolvePriorityFn } from "@common/utils/project-manager/priority.ts";
import { canUpdateProjectResource, Scope, type CallerCtx } from "../../utils/permissions.ts";

interface Props {
	issues: Issue[];
	project: Project;
	perms: Permission[];
	caller?: CallerCtx;
	isDragEnabled: boolean;
	onOpen: (issue: Issue) => void;
	onMove: (issue: Issue, columnKey: string) => void;
}

export function BacklogTable({ issues, project, perms, caller, isDragEnabled, onOpen, onMove }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const scoreFn = resolvePriorityFn(project.priorityStrategy);
	const columnOptions = JSON.stringify(project.kanbanColumns.map((c) => ({ label: c.name, value: c.key })));

	return (
		<table className="w-full border-collapse">
			<thead>
				<tr className="border-b border-border">
					<th className="text-left p-2 text-xs uppercase text-muted">{t("issues.key")}</th>
					<th className="text-left p-2 text-xs uppercase text-muted">{t("issues.issueTitle")}</th>
					<th className="text-left p-2 text-xs uppercase text-muted">{t("issues.column")}</th>
					<th className="text-left p-2 text-xs uppercase text-muted">{t("issues.priority")}</th>
					<th className="text-left p-2 text-xs uppercase text-muted">{t("common.actions")}</th>
				</tr>
			</thead>
			<tbody>
				{issues.map((issue) => {
					const score = scoreFn(issue.priority);
					return (
						<tr
							key={issue.id}
							className="border-t border-border"
							draggable={isDragEnabled}
							onDragStart={
								isDragEnabled
									? (e) => {
											e.dataTransfer.effectAllowed = "move";
											e.dataTransfer.setData("text/plain", issue.id);
										}
									: undefined
							}
						>
							<td className="p-2 font-mono text-xs">{issue.key}</td>
							<td className="p-2 text-sm">{issue.title}</td>
							<td className="p-2 text-sm">
								{canUpdateProjectResource(perms, Scope.ISSUES, project, caller) ? (
									<adc-combobox
										value={issue.columnKey}
										clearable={false}
										options={columnOptions}
										onadcChange={(e: any) => onMove(issue, e.detail)}
									/>
								) : (
									<adc-badge color="gray" size="sm">
										{issue.columnKey}
									</adc-badge>
								)}
							</td>
							<td className="p-2 text-xs">{Number.isFinite(score) ? score.toFixed(2) : "—"}</td>
							<td className="p-2">
								<adc-button variant="accent" onClick={() => onOpen(issue)}>
									{t("common.open")}
								</adc-button>
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}
