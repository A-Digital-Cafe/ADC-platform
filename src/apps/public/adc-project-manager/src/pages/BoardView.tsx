import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { Sprint } from "@common/types/project-manager/Sprint.ts";
import type { Milestone } from "@common/types/project-manager/Milestone.ts";
import type { TransitionCommentSubmitDetail } from "../components/TransitionCommentModal.tsx";
import { TransitionCommentModal } from "../components/TransitionCommentModal.tsx";
import { type IssueListParams } from "../utils/pm-api.ts";
import { useBacklogData } from "../hooks/useBacklogData.ts";
import { useIssueMover } from "../hooks/useIssueMover.ts";
import { IssueDialog } from "../components/IssueDialog.tsx";
import { BoardColumn } from "../components/board/BoardColumn.tsx";
import { BoardFilters, type BoardFilterState } from "../components/board/BoardFilters.tsx";
import { canWriteProjectResource, canUpdateProjectResource, Scope, type CallerCtx } from "../utils/permissions.ts";

interface Props {
	project: Project;
	perms: Permission[];
	caller?: CallerCtx;
}

function applyFilters(issues: Issue[], f: BoardFilterState, q: string): Issue[] {
	return issues.filter((i) => {
		if (f.sprintId && i.sprintId !== f.sprintId) return false;
		if (f.milestoneId && i.milestoneId !== f.milestoneId) return false;
		if (f.assigneeId && !i.assigneeIds.includes(f.assigneeId)) return false;
		if (q) {
			const needle = q.toLowerCase();
			if (!i.title.toLowerCase().includes(needle) && !i.description.toLowerCase().includes(needle)) return false;
		}
		return true;
	});
}

export function BoardView({ project, perms, caller }: Props) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [q, setQ] = useState("");
	const [filters, setFilters] = useState<BoardFilterState>({});
	const [editingIssue, setEditingIssue] = useState<Issue | null>(null);
	const [creating, setCreating] = useState(false);
	const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

	const { issues, setIssues, sprints, milestones, loading, reload } = useBacklogData({
		projectId: project.id,
		q: "",
		orderBy: "priority" as IssueListParams["orderBy"],
	});

	const filteredIssues = useMemo(() => applyFilters(issues, filters, q), [issues, filters, q]);

	const columnsOrdered = useMemo(() => [...project.kanbanColumns].sort((a, b) => a.order - b.order), [project.kanbanColumns]);

	const byColumn = useMemo(() => {
		const map = new Map<string, Issue[]>();
		for (const col of columnsOrdered) map.set(col.key, []);
		for (const i of filteredIssues) {
			const bucket = map.get(i.columnKey);
			if (bucket) bucket.push(i);
		}
		return map;
	}, [filteredIssues, columnsOrdered]);

	const mover = useIssueMover({
		project,
		onSuccess: async () => {
			await reload();
		},
		onFailure: async () => {
			await reload();
		},
	});

	const handleMove = useCallback(
		async (issueId: string, targetColumn: string) => {
			const issue = issues.find((i) => i.id === issueId);
			if (!issue || issue.columnKey === targetColumn) return;
			// Optimistic
			setIssues((prev) => prev.map((i) => (i.id === issueId ? { ...i, columnKey: targetColumn } : i)));
			await mover.requestMove(issueId, issue.columnKey, targetColumn);
		},
		[issues, setIssues, mover]
	);

	const isDragEnabled = canUpdateProjectResource(perms, Scope.ISSUES, project, caller);
	const showDialog = editingIssue || creating;

	return (
		<div className="space-y-4">
			<BoardFilters
				q={q}
				onQChange={setQ}
				filters={filters}
				onFiltersChange={setFilters}
				sprints={sprints}
				milestones={milestones}
				trailing={
					canWriteProjectResource(perms, Scope.ISSUES, project, caller) ? (
						<adc-button variant="primary" onClick={() => setCreating(true)}>
							{t("issues.newIssue")}
						</adc-button>
					) : undefined
				}
			/>

			{loading ? (
				<adc-skeleton variant="rectangular" height="400px" />
			) : (
				<div className="overflow-x-auto pb-2">
					<div className="flex gap-3 min-w-max">
						{columnsOrdered.map((col) => {
							const colIssues = byColumn.get(col.key) ?? [];
							const wipLimit = project.settings?.wipLimits?.[col.key];
							const overLimit = wipLimit !== undefined && colIssues.length >= wipLimit;
							return (
								<BoardColumn
									key={col.id}
									column={col}
									issues={colIssues}
									sprints={sprints as Sprint[]}
									milestones={milestones as Milestone[]}
									customFieldDefs={project.customFieldDefs}
									wipLimit={wipLimit}
									overLimit={overLimit}
									isDragEnabled={isDragEnabled}
									isDropActive={dragOverColumn === col.key}
									onDragOver={isDragEnabled ? () => setDragOverColumn(col.key) : undefined}
									onDragLeave={isDragEnabled ? () => setDragOverColumn((c) => (c === col.key ? null : c)) : undefined}
									onDrop={(id) => {
										setDragOverColumn(null);
										handleMove(id, col.key);
									}}
									onOpen={setEditingIssue}
								/>
							);
						})}
					</div>
				</div>
			)}

			{showDialog && (
				<IssueDialog
					project={project}
					issue={editingIssue}
					perms={perms}
					caller={caller}
					sprints={sprints}
					milestones={milestones}
					onClose={() => {
						setEditingIssue(null);
						setCreating(false);
					}}
					onSaved={async () => {
						setEditingIssue(null);
						setCreating(false);
						await reload();
					}}
				/>
			)}

			<TransitionCommentModal
				open={!!mover.pendingMove}
				submitting={mover.moving}
				fromColumn={mover.pendingMove ? project.kanbanColumns.find((c) => c.key === mover.pendingMove?.fromColumn)?.name : undefined}
				toColumn={mover.pendingMove ? project.kanbanColumns.find((c) => c.key === mover.pendingMove?.toColumn)?.name : undefined}
				onCancel={() => {
					mover.cancelMove();
					void reload();
				}}
				onSubmit={(detail: TransitionCommentSubmitDetail) => {
					void mover.confirmMoveWithComment(detail);
				}}
			/>
		</div>
	);
}
