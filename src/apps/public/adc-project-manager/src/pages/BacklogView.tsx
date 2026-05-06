import { useCallback, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { TransitionCommentSubmitDetail } from "../components/TransitionCommentModal.tsx";
import { TransitionCommentModal } from "../components/TransitionCommentModal.tsx";
import { pmApi, type IssueListParams } from "../utils/pm-api.ts";
import { IssueDialog } from "../components/IssueDialog.tsx";
import { BacklogFilters } from "../components/backlog/BacklogFilters.tsx";
import { BacklogTable } from "../components/backlog/BacklogTable.tsx";
import { BacklogSection, type GroupSection } from "../components/backlog/BacklogSection.tsx";
import { CompletedGroupUmbrella } from "../components/backlog/CompletedGroupUmbrella.tsx";
import { useBacklogSections } from "../hooks/useBacklogSections.ts";
import { useBacklogData } from "../hooks/useBacklogData.ts";
import { useBacklogGroupByPref } from "../hooks/useBacklogGroupByPref.ts";
import { useIssueMover } from "../hooks/useIssueMover.ts";
import { canWriteProjectResource, canUpdateProjectResource, Scope, type CallerCtx } from "../utils/permissions.ts";

interface Props {
	project: Project;
	perms: Permission[];
	caller?: CallerCtx;
}

const COMPLETED_UMBRELLA_KEY = "__completed__";

export function BacklogView({ project, perms, caller }: Props) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [q, setQ] = useState("");
	const [orderBy, setOrderBy] = useState<IssueListParams["orderBy"]>("priority");
	const [editingIssue, setEditingIssue] = useState<Issue | null>(null);
	const [creating, setCreating] = useState(false);
	// Estado de colapso efímero: togglear un grupo NO debe disparar PATCH.
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	const [dragTargetId, setDragTargetId] = useState<string | null>(null);

	const { groupBy, updateGroupBy, loaded: prefsLoaded } = useBacklogGroupByPref();
	const { issues, setIssues, sprints, milestones, loading, reload } = useBacklogData({ projectId: project.id, q, orderBy });
	const sections = useBacklogSections(groupBy, issues, sprints, milestones, t("issues.unassigned"));

	const isDoneColumn = useCallback(
		(columnKey: string) => project.kanbanColumns.find((c) => c.key === columnKey)?.isDone === true,
		[project.kanbanColumns]
	);

	const toggleCollapsed = (key: string, defaultCollapsed = false) =>
		setCollapsed((prev) => ({
			...prev,
			[key]: !(prev[key] ?? defaultCollapsed),
		}));

	const mover = useIssueMover({
		project,
		onSuccess: async () => {
			await reload();
		},
		onFailure: async () => {
			await reload();
		},
	});

	const handleMove = async (issue: Issue, columnKey: string) => {
		await mover.requestMove(issue.id, issue.columnKey, columnKey);
	};

	const handleDrop = async (section: GroupSection, issueId: string) => {
		if (groupBy !== "sprint") return;
		const issue = issues.find((i) => i.id === issueId);
		if (!issue) return;
		const nextSprintId = section.targetId ?? undefined;
		if (issue.sprintId === nextSprintId) return;
		setIssues((prev) => prev.map((i) => (i.id === issueId ? { ...i, sprintId: nextSprintId } : i)));
		const res = await pmApi.updateIssue(issueId, { sprintId: nextSprintId as string | undefined });
		if (!res.success) await reload();
	};

	const showDialog = editingIssue || creating;
	const isDragEnabled = groupBy === "sprint" && canUpdateProjectResource(perms, Scope.ISSUES, project, caller);

	const renderSection = (section: GroupSection, defaultCollapsed: boolean) => {
		const collapseKey = `${groupBy}:${section.id}`;
		return (
			<BacklogSection
				key={section.id}
				section={section}
				project={project}
				perms={perms}
				caller={caller}
				isCollapsed={collapsed[collapseKey] ?? defaultCollapsed}
				isDragEnabled={isDragEnabled}
				isDropActive={dragTargetId === section.id && isDragEnabled}
				doneCount={section.issues.filter((i) => isDoneColumn(i.columnKey)).length}
				onToggleCollapsed={() => toggleCollapsed(collapseKey, defaultCollapsed)}
				onOpenIssue={setEditingIssue}
				onMoveIssue={handleMove}
				onDragOver={isDragEnabled ? () => setDragTargetId((prev) => (prev === section.id ? prev : section.id)) : undefined}
				onDragLeave={isDragEnabled ? () => setDragTargetId((prev) => (prev === section.id ? null : prev)) : undefined}
				onDrop={
					isDragEnabled
						? (id) => {
								setDragTargetId(null);
								handleDrop(section, id);
							}
						: undefined
				}
			/>
		);
	};

	return (
		<div className="space-y-4">
			<BacklogFilters
				q={q}
				onQChange={setQ}
				orderBy={orderBy}
				onOrderByChange={setOrderBy}
				groupBy={groupBy}
				onGroupByChange={updateGroupBy}
				trailing={
					canWriteProjectResource(perms, Scope.ISSUES, project, caller) ? (
						<adc-button variant="primary" onClick={() => setCreating(true)}>
							{t("issues.newIssue")}
						</adc-button>
					) : undefined
				}
			/>

			{loading || !prefsLoaded ? (
				<adc-skeleton variant="rectangular" height="400px" />
			) : issues.length === 0 ? (
				<p className="text-muted text-center py-8">{t("issues.noIssues")}</p>
			) : groupBy === "none" ? (
				<div className="overflow-visible">
					<BacklogTable
						issues={issues}
						project={project}
						perms={perms}
						caller={caller}
						isDragEnabled={false}
						onOpen={setEditingIssue}
						onMove={handleMove}
					/>
				</div>
			) : (
				<div className="space-y-4">
					<CompletedGroupUmbrella
						sections={sections.filter((s) => s.isCompleted)}
						isCollapsed={collapsed[COMPLETED_UMBRELLA_KEY] ?? true}
						onToggleCollapsed={() => toggleCollapsed(COMPLETED_UMBRELLA_KEY, true)}
						renderSection={renderSection}
					/>
					{sections.filter((s) => !s.isCompleted).map((s) => renderSection(s, false))}
				</div>
			)}
			{isDragEnabled && <p className="text-xs text-muted">{t("issues.moveHint")}</p>}
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
