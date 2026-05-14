import { useTranslation } from "@ui-library/utils/i18n-react";
import type { KanbanColumn } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { Sprint } from "@common/types/project-manager/Sprint.ts";
import type { Milestone } from "@common/types/project-manager/Milestone.ts";
import type { CustomFieldDef } from "@common/types/project-manager/CustomField.ts";
import { IssueCard } from "./IssueCard.tsx";

interface Props {
	column: KanbanColumn;
	issues: Issue[];
	sprints: Sprint[];
	milestones: Milestone[];
	customFieldDefs?: CustomFieldDef[];
	wipLimit: number | undefined;
	overLimit: boolean;
	isDragEnabled: boolean;
	isDropActive: boolean;
	onDragOver?: () => void;
	onDragLeave?: () => void;
	onDrop: (issueId: string) => void;
	onOpen: (issue: Issue) => void;
}

export function BoardColumn({
	column,
	issues,
	customFieldDefs,
	wipLimit,
	overLimit,
	isDragEnabled,
	isDropActive,
	onDragOver,
	onDragLeave,
	onDrop,
	onOpen,
}: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const baseCls = "flex flex-col w-72 shrink-0 rounded-lg border bg-background/40 p-2 min-h-[60vh]";
	const activeCls = isDropActive ? "border-primary ring-2 ring-primary/40" : "border-text/15";

	return (
		<section
			className={`${baseCls} ${activeCls}`}
			aria-label={column.name}
			onDragOver={
				isDragEnabled && onDragOver
					? (e) => {
							e.preventDefault();
							e.dataTransfer.dropEffect = "move";
							onDragOver();
						}
					: undefined
			}
			onDragLeave={isDragEnabled ? onDragLeave : undefined}
			onDrop={
				isDragEnabled
					? (e) => {
							e.preventDefault();
							const id = e.dataTransfer.getData("text/plain");
							if (id) onDrop(id);
						}
					: undefined
			}
		>
			<header className="flex items-center justify-between gap-2 px-1 pb-2 border-b border-text/70">
				<div className="flex items-center gap-2 min-w-0">
					{column.color && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: column.color }} />}
					<h4 className="font-heading text-sm font-semibold text-text truncate">{column.name}</h4>
					<span className="text-xs text-muted">
						{issues.length}
						{wipLimit === undefined ? "" : ` / ${wipLimit}`}
					</span>
				</div>
				{column.isDone && (
					<adc-badge color="green" size="sm">
						{t("board.done")}
					</adc-badge>
				)}
				{column.isAuto && !column.isDone && (
					<adc-badge color="blue" size="sm">
						{t("board.auto")}
					</adc-badge>
				)}
			</header>
			{overLimit && <p className="text-[11px] text-tdanger px-1 pt-1">{t("board.wipLimitReached")}</p>}
			<div className="flex flex-col gap-2 py-2 overflow-y-auto">
				{issues.length === 0 ? (
					<p className="text-muted text-xs text-center py-4">{t("board.emptyColumn")}</p>
				) : (
					issues.map((issue) => (
						<IssueCard
							key={issue.id}
							issue={issue}
							isDraggable={isDragEnabled}
							customFieldDefs={customFieldDefs}
							onOpen={() => onOpen(issue)}
						/>
					))
				)}
			</div>
		</section>
	);
}
