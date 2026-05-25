import { useMemo } from "react";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { Sprint } from "@common/types/project-manager/Sprint.ts";
import type { Milestone } from "@common/types/project-manager/Milestone.ts";
import type { GroupSection } from "../components/backlog/BacklogSection.tsx";
import type { GroupBy } from "../components/backlog/BacklogFilters.tsx";

const UNASSIGNED_KEY = "__unassigned__";

type GroupEntity = Pick<Sprint | Milestone, "id" | "name" | "status">;

function isCompletedEntity(e: GroupEntity): boolean {
	return e.status === "completed" || e.status === "cancelled";
}

/**
 * Construye las secciones agrupadas del backlog (activos, completados, sin asignar).
 * Devuelve una única sección "all" cuando `groupBy === "none"`.
 */
export function useBacklogSections(
	groupBy: GroupBy,
	issues: Issue[],
	sprints: Sprint[],
	milestones: Milestone[],
	unassignedLabel: string
): GroupSection[] {
	return useMemo(() => {
		if (groupBy === "none") {
			return [{ id: "all", label: "", issues, targetId: null }];
		}
		const isSprintMode = groupBy === "sprint";
		const entities: GroupEntity[] = isSprintMode ? sprints : milestones;

		const bucket = new Map<string, Issue[]>();
		for (const issue of issues) {
			const key = (isSprintMode ? issue.sprintId : issue.milestoneId) || UNASSIGNED_KEY;
			const arr = bucket.get(key) ?? [];
			arr.push(issue);
			bucket.set(key, arr);
		}

		const result: GroupSection[] = [];
		for (const entity of entities) {
			const completed = isCompletedEntity(entity);
			if (completed) continue;
			result.push({ id: entity.id, label: entity.name, issues: bucket.get(entity.id) ?? [], targetId: entity.id });
		}
		for (const entity of entities) {
			if (!isCompletedEntity(entity)) continue;
			result.push({ id: entity.id, label: entity.name, issues: bucket.get(entity.id) ?? [], targetId: entity.id, isCompleted: true });
		}
		result.push({ id: UNASSIGNED_KEY, label: unassignedLabel, issues: bucket.get(UNASSIGNED_KEY) ?? [], targetId: null });
		return result;
	}, [groupBy, issues, sprints, milestones, unassignedLabel]);
}
