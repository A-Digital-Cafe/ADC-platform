import type { CustomFieldDef } from "./CustomField.ts";
import type { IssueLinkType } from "./IssueLink.ts";

/** Visibilidad del proyecto. */
export type ProjectVisibility = "private" | "org" | "public";

/** Override de permisos por rol dentro de un proyecto. */
export interface ProjectRoleOverride {
	roleId: string;
	/** Permissions en formato bitfield (scope, action) para `project-manager`. */
	permissions: Array<{ scope: number; action: number }>;
}

/** Columna del kanban configurable por proyecto. */
export interface KanbanColumn {
	id: string;
	key: string;
	name: string;
	order: number;
	color?: string;
	/** Marca la columna como "finalizado" (al mover un issue aquí se setea `closedAt`). */
	isDone?: boolean;
	/** Marca la columna donde caen los issues recién creados. */
	isAuto?: boolean;
}

/** Estrategias soportadas para calcular prioridad. */
export type PriorityStrategyId = "matrix-eisenhower" | "weighted-sum" | "wsjf-like";

/** Configuración de estrategia de prioridad del proyecto. */
export interface PriorityStrategy {
	id: PriorityStrategyId;
	/** Pesos (solo usados por `weighted-sum`). */
	weights?: { urgency: number; importance: number; difficulty: number };
}

/** Configuración general del proyecto. */
export interface ProjectSettings {
	/** Límites WIP por columna (por `column.key`). */
	wipLimits?: Record<string, number>;
	/**
	 * Si está activo, mover un issue a una columna `isDone` requiere dejar un
	 * comentario explicando el cierre. El comentario se guarda con `label =
	 * "transition-reason"` para que el frontend lo destaque visualmente.
	 */
	requireCommentOnFinalTransition?: boolean;
}

/** Proyecto del Project Manager. */
export interface Project {
	id: string;
	/** `null` = proyecto global (no pertenece a ninguna org). */
	orgId: string | null;
	slug: string;
	name: string;
	description?: string;
	ownerId: string;
	visibility: ProjectVisibility;

	memberUserIds: string[];
	memberGroupIds: string[];
	roleOverrides: ProjectRoleOverride[];

	kanbanColumns: KanbanColumn[];
	customFieldDefs: CustomFieldDef[];
	issueLinkTypes: IssueLinkType[];
	priorityStrategy: PriorityStrategy;
	settings: ProjectSettings;

	/** Contador autoincremental para generar issue keys (`PROJ-123`). */
	issueCounter: number;

	createdAt: Date;
	updatedAt: Date;
}

/** Proyecto expuesto al cliente (sin campos internos). */
export type ClientProject = Project;
