import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { Project } from "@common/types/project-manager/Project.ts";

/**
 * Modo enfoque para neurodivergentes.
 * Devuelve el set de issue ids que deben visualizarse "apagados" (muted).
 *
 * El foco son las columnas WIP-limitadas, que son las que declaran el trabajo en curso: se activa
 * cuando una alcanza su límite, o sobre todas las limitadas si `forced`. Sin límites WIP
 * configurados devuelve vacío incluso con `forced`: apagar el tablero entero no es un modo enfoque.
 */
export function computeMutedIssueIds(project: Project, issues: Issue[], forced?: boolean): Set<string> {
	const muted = new Set<string>();
	const wipLimits = project.settings?.wipLimits ?? {};

	if (Object.keys(wipLimits).length === 0) return muted;

	const focused = new Set<string>();
	for (const [colKey, limit] of Object.entries(wipLimits)) {
		const count = issues.filter((i) => i.columnKey === colKey).length;
		if (forced || count >= limit) focused.add(colKey);
	}

	if (focused.size === 0) return muted;

	for (const issue of issues) {
		if (!focused.has(issue.columnKey)) muted.add(issue.id);
	}
	return muted;
}
