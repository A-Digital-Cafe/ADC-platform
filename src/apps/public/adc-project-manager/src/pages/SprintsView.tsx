import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Sprint } from "@common/types/project-manager/Sprint.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import { pmApi } from "../utils/pm-api.ts";
import { canWriteProjectResource, Scope, type CallerCtx } from "../utils/permissions.ts";
import { SprintCard } from "../components/sprints/SprintCard.tsx";
import { SimpleCreateModal } from "../components/SimpleCreateModal.tsx";

interface Props {
	project: Project;
	perms: Permission[];
	caller?: CallerCtx;
}

export function SprintsView({ project, perms, caller }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [sprints, setSprints] = useState<Sprint[]>([]);
	const [issues, setIssues] = useState<Issue[]>([]);
	const [loading, setLoading] = useState(true);
	const [showCreate, setShowCreate] = useState(false);

	const doneKeys = useMemo(() => new Set(project.kanbanColumns.filter((c) => c.isDone).map((c) => c.key)), [project.kanbanColumns]);

	const countsBySprint = useMemo(() => {
		const map = new Map<string, { total: number; done: number }>();
		for (const issue of issues) {
			if (!issue.sprintId) continue;
			const entry = map.get(issue.sprintId) ?? { total: 0, done: 0 };
			entry.total += 1;
			if (doneKeys.has(issue.columnKey)) entry.done += 1;
			map.set(issue.sprintId, entry);
		}
		return map;
	}, [issues, doneKeys]);

	const load = useCallback(async () => {
		setLoading(true);
		const [sprintsRes, issuesRes] = await Promise.all([pmApi.listSprints(project.id), pmApi.listIssues(project.id)]);
		if (sprintsRes.success && sprintsRes.data) setSprints(sprintsRes.data.sprints);
		if (issuesRes.success && issuesRes.data) setIssues(issuesRes.data.issues);
		setLoading(false);
	}, [project.id]);

	useEffect(() => {
		load();
	}, [load]);

	const handleCreate = async ({ name, description }: { name: string; description: string }) => {
		const res = await pmApi.createSprint(project.id, { name, goal: description || undefined });
		if (res.success) {
			setShowCreate(false);
			await load();
		}
	};

	const handleStart = async (id: string) => {
		const res = await pmApi.startSprint(id);
		if (res.success) await load();
	};

	const handleComplete = async (id: string) => {
		const res = await pmApi.completeSprint(id);
		if (res.success) await load();
	};

	const handleDelete = async (id: string) => {
		if (!globalThis.confirm(t("common.confirmDelete"))) return;
		const res = await pmApi.deleteSprint(id);
		if (res.success) await load();
	};

	if (loading) return <adc-skeleton variant="rectangular" height="300px" />;

	return (
		<div className="space-y-4">
			{canWriteProjectResource(perms, Scope.SPRINTS, project, caller) && (
				<div className="flex justify-end">
					<adc-button variant="primary" onClick={() => setShowCreate(true)}>
						{t("common.add")}
					</adc-button>
				</div>
			)}

			{sprints.length === 0 ? (
				<p className="text-muted text-center py-8">{t("common.noData")}</p>
			) : (
				<div className="space-y-3">
					{sprints.map((s) => {
						const c = countsBySprint.get(s.id) ?? { total: 0, done: 0 };
						return (
							<SprintCard
								key={s.id}
								sprint={s}
								doneCount={c.done}
								totalCount={c.total}
								perms={perms}
								project={project}
								caller={caller}
								onStart={handleStart}
								onComplete={handleComplete}
								onDelete={handleDelete}
								onUpdated={load}
							/>
						);
					})}
				</div>
			)}

			{showCreate && (
				<SimpleCreateModal title={t("common.add") + " Sprint"} onClose={() => setShowCreate(false)} onSubmit={handleCreate} />
			)}
		</div>
	);
}
