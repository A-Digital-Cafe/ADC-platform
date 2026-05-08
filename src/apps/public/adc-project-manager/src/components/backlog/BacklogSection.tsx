import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import { BacklogTable } from "./BacklogTable.tsx";
import type { CallerCtx } from "../../utils/permissions.ts";

export interface GroupSection {
	id: string;
	label: string;
	issues: Issue[];
	/** `null` para "sin asignar"; el id del entity para sprints/milestones. */
	targetId: string | null;
	isCompleted?: boolean;
}

interface Props {
	section: GroupSection;
	project: Project;
	perms: Permission[];
	caller?: CallerCtx;
	isCollapsed: boolean;
	isDragEnabled: boolean;
	isDropActive: boolean;
	doneCount: number;
	onToggleCollapsed: () => void;
	onOpenIssue: (issue: Issue) => void;
	onMoveIssue: (issue: Issue, columnKey: string) => void;
	onDragOver?: () => void;
	onDragLeave?: () => void;
	onDrop?: (issueId: string) => void;
}

export function BacklogSection({
	section,
	project,
	perms,
	caller,
	isCollapsed,
	isDragEnabled,
	isDropActive,
	doneCount,
	onToggleCollapsed,
	onOpenIssue,
	onMoveIssue,
	onDragOver,
	onDragLeave,
	onDrop,
}: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const total = section.issues.length;

	return (
		<section
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
				isDragEnabled && onDrop
					? (e) => {
							e.preventDefault();
							const id = e.dataTransfer.getData("text/plain");
							if (id) onDrop(id);
						}
					: undefined
			}
			className={isDropActive ? "rounded-md ring-2 ring-primary/60 bg-primary/5" : undefined}
		>
			<button
				type="button"
				className="w-full flex items-center gap-2 text-left py-1 px-1 hover:bg-surface-alt rounded"
				onClick={onToggleCollapsed}
				aria-expanded={!isCollapsed}
			>
				<span className="text-muted text-xs w-4">{isCollapsed ? "▶" : "▼"}</span>
				<h4 className="font-heading text-base font-semibold text-text">
					{section.label}
					{section.isCompleted && <span className="ml-2 text-xs text-muted font-normal">({t("sprints.completed")})</span>}
				</h4>
				<span className="text-muted font-normal text-sm">
					{t("issues.countDone", { done: String(doneCount), total: String(total) })}
				</span>
			</button>
			{!isCollapsed && (
				<div className="pl-6 pt-2">
					{total === 0 ? (
						<p className="text-muted text-sm">{t("issues.noIssues")}</p>
					) : (
						<div className="overflow-visible">
							<BacklogTable
								issues={section.issues}
								project={project}
								perms={perms}
								caller={caller}
								isDragEnabled={isDragEnabled}
								onOpen={onOpenIssue}
								onMove={onMoveIssue}
							/>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
