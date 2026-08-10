import type { Issue, IssuePriority, UrgencyImportance, Difficulty } from "@common/types/project-manager/Issue.ts";
import type { PriorityStrategy, PriorityStrategyId } from "@common/types/project-manager/Project.ts";

type PriorityScoreFn = (priority: IssuePriority) => number;

const DEFAULT_WEIGHTS = { urgency: 2, importance: 3, difficulty: 1 } as const;

const STRATEGIES: Record<PriorityStrategyId, (s: PriorityStrategy) => PriorityScoreFn> = {
	"matrix-eisenhower": () => (p) => p.urgency * 10 + p.importance,
	"weighted-sum": (s) => {
		const w = s.weights ?? DEFAULT_WEIGHTS;
		return (p) => w.urgency * p.urgency + w.importance * p.importance - w.difficulty * (p.difficulty ?? 0);
	},
	"wsjf-like": () => (p) => (p.urgency + p.importance) / Math.max(p.difficulty ?? 1, 1),
};

/** @public Devuelve una función de score para la estrategia configurada. **/
export function resolvePriorityFn(strategy: PriorityStrategy): PriorityScoreFn {
	const factory = STRATEGIES[strategy.id] ?? STRATEGIES["matrix-eisenhower"];
	return factory(strategy);
}

/** @public Ordena issues in-place por score descendente según strategy. */
export function sortIssuesByPriority<T extends Pick<Issue, "priority">>(issues: T[], strategy: PriorityStrategy): T[] {
	const scoreFn = resolvePriorityFn(strategy);
	return [...issues].sort((a, b) => scoreFn(b.priority) - scoreFn(a.priority));
}

/** @public */
export function normalizeUrgency(v: unknown): UrgencyImportance {
	const n = Number(v);
	if (Number.isNaN(n)) return 0;
	return Math.max(0, Math.min(4, Math.trunc(n))) as UrgencyImportance;
}

/** @public */
export function normalizeDifficulty(v: unknown): Difficulty {
	if (v === null || v === undefined || v === "") return null;
	const n = Number(v);
	if (Number.isNaN(n)) return null;
	return Math.max(1, Math.min(5, Math.trunc(n))) as Difficulty;
}
