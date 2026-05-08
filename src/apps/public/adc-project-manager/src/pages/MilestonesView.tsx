import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Milestone } from "@common/types/project-manager/Milestone.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import { pmApi } from "../utils/pm-api.ts";
import { canWriteProjectResource, Scope, type CallerCtx } from "../utils/permissions.ts";
import { MilestoneCard } from "../components/milestones/MilestoneCard.tsx";
import { SimpleCreateModal } from "../components/SimpleCreateModal.tsx";

interface Props {
	project: Project;
	perms: Permission[];
	caller?: CallerCtx;
}

export function MilestonesView({ project, perms, caller }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [milestones, setMilestones] = useState<Milestone[]>([]);
	const [issues, setIssues] = useState<Issue[]>([]);
	const [loading, setLoading] = useState(true);
	const [showCreate, setShowCreate] = useState(false);

	const doneKeys = useMemo(() => new Set(project.kanbanColumns.filter((c) => c.isDone).map((c) => c.key)), [project.kanbanColumns]);

	const countsByMilestone = useMemo(() => {
		const map = new Map<string, { total: number; done: number }>();
		for (const issue of issues) {
			if (!issue.milestoneId) continue;
			const entry = map.get(issue.milestoneId) ?? { total: 0, done: 0 };
			entry.total += 1;
			if (doneKeys.has(issue.columnKey)) entry.done += 1;
			map.set(issue.milestoneId, entry);
		}
		return map;
	}, [issues, doneKeys]);

	const load = useCallback(async () => {
		setLoading(true);
		const [milestonesRes, issuesRes] = await Promise.all([pmApi.listMilestones(project.id), pmApi.listIssues(project.id)]);
		if (milestonesRes.success && milestonesRes.data) setMilestones(milestonesRes.data.milestones);
		if (issuesRes.success && issuesRes.data) setIssues(issuesRes.data.issues);
		setLoading(false);
	}, [project.id]);

	useEffect(() => {
		load();
	}, [load]);

	const handleCreate = async ({ name, description }: { name: string; description: string }) => {
		const res = await pmApi.createMilestone(project.id, { name, description: description || undefined });
		if (res.success) {
			setShowCreate(false);
			await load();
		}
	};

	const handleDelete = async (id: string) => {
		if (!globalThis.confirm(t("common.confirmDelete"))) return;
		const res = await pmApi.deleteMilestone(id);
		if (res.success) await load();
	};

	if (loading) return <adc-skeleton variant="rectangular" height="300px" />;

	return (
		<div className="space-y-4">
			{canWriteProjectResource(perms, Scope.MILESTONES, project, caller) && (
				<div className="flex justify-end">
					<adc-button variant="primary" onClick={() => setShowCreate(true)}>
						{t("common.add")}
					</adc-button>
				</div>
			)}

			{milestones.length === 0 ? (
				<p className="text-muted text-center py-8">{t("common.noData")}</p>
			) : (
				<div className="space-y-3">
					{milestones.map((m) => {
						const c = countsByMilestone.get(m.id) ?? { total: 0, done: 0 };
						return (
							<MilestoneCard
								key={m.id}
								milestone={m}
								doneCount={c.done}
								totalCount={c.total}
								perms={perms}
								project={project}
								caller={caller}
								onDelete={handleDelete}
								onUpdated={load}
							/>
						);
					})}
				</div>
			)}

			{showCreate && (
				<SimpleCreateModal title={t("common.add") + " Milestone"} onClose={() => setShowCreate(false)} onSubmit={handleCreate} />
			)}
		</div>
	);
}
