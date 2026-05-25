export { PMScopes as Scope } from "@common/types/project-manager/permissions.ts";

import { PMScopes } from "@common/types/project-manager/permissions.ts";
import { CRUDXAction } from "@common/types/Actions";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import { hasPermission } from "@common/utils/perms.ts";

export interface PMTab {
	id: string;
	label: string;
	requiredScope: number;
	requiredAction: number;
}

/** Tabs dentro de un proyecto */
const PROJECT_TABS: PMTab[] = [
	{ id: "board", label: "board", requiredScope: PMScopes.ISSUES, requiredAction: CRUDXAction.READ },
	{ id: "backlog", label: "backlog", requiredScope: PMScopes.ISSUES, requiredAction: CRUDXAction.READ },
	{ id: "calendar", label: "calendar", requiredScope: PMScopes.ISSUES, requiredAction: CRUDXAction.READ },
	{ id: "sprints", label: "sprints", requiredScope: PMScopes.SPRINTS, requiredAction: CRUDXAction.READ },
	{ id: "milestones", label: "milestones", requiredScope: PMScopes.MILESTONES, requiredAction: CRUDXAction.READ },
	{ id: "settings", label: "settings", requiredScope: PMScopes.SETTINGS, requiredAction: CRUDXAction.READ },
];

const RESOURCE = "project-manager";

export interface CallerCtx {
	userId?: string;
	groupIds?: string[];
}

/** Devuelve `true` si el caller es owner, miembro o pertenece a un group miembro del proyecto. */
function isProjectMember(project: Project | null | undefined, caller: CallerCtx | null | undefined): boolean {
	if (!project || !caller?.userId) return false;
	if (project.ownerId === caller.userId) return true;
	if (project.memberUserIds?.includes(caller.userId)) return true;
	const gids = caller.groupIds ?? [];
	return project.memberGroupIds?.some((gid) => gids.includes(gid)) ?? false;
}

/** Devuelve `true` si el caller es asignado al issue (directo o vía group). */
function isIssueAssignee(issue: Issue | null | undefined, caller: CallerCtx | null | undefined): boolean {
	if (!issue || !caller?.userId) return false;
	if (issue.assigneeIds?.includes(caller.userId)) return true;
	const gids = caller.groupIds ?? [];
	return issue.assigneeGroupIds?.some((gid) => gids.includes(gid)) ?? false;
}

/** Verifica acceso básico a proyectos (permiso formal). */
export function canAccessProjects(perms: Permission[]): boolean {
	return hasPermission(perms, RESOURCE, CRUDXAction.READ, PMScopes.PROJECTS);
}

export function getVisibleProjectTabs(perms: Permission[], project?: Project | null, caller?: CallerCtx): PMTab[] {
	const isMember = isProjectMember(project, caller);
	const isOwner = !!project && !!caller?.userId && project.ownerId === caller.userId;
	return PROJECT_TABS.filter((tab) => {
		// El owner siempre ve todos los tabs (incluye settings); refleja `projectOwnerAllowIf` del backend.
		if (isOwner) return true;
		// Miembros ven todos los tabs de contenido (board/issues/calendar/sprints/milestones).
		// `settings` se mantiene gated por permiso formal para evitar que cualquier miembro edite.
		if (isMember && tab.id !== "settings") return true;
		return hasPermission(perms, RESOURCE, tab.requiredAction, tab.requiredScope, {
			selfId: caller?.userId,
			ownerId: project?.ownerId,
		});
	});
}

function canWrite(perms: Permission[], scope: number, opts?: { ownerId?: string; selfId?: string }): boolean {
	return hasPermission(perms, RESOURCE, CRUDXAction.WRITE, scope, opts);
}
function canUpdate(perms: Permission[], scope: number, opts?: { ownerId?: string; selfId?: string }): boolean {
	return hasPermission(perms, RESOURCE, CRUDXAction.UPDATE, scope, opts);
}
function canDelete(perms: Permission[], scope: number, opts?: { ownerId?: string; selfId?: string }): boolean {
	return hasPermission(perms, RESOURCE, CRUDXAction.DELETE, scope, opts);
}

export interface ProjectCreatePerms {
	/** El caller es admin global (rol Admin sin orgId). */
	isAdmin: boolean;
	/** El caller es Admin o PM dentro de su propia org (según token). */
	isOrgAdmin: boolean;
	/** orgId del token actual (modo org). `undefined` = modo global/personal. */
	orgId?: string;
	/** Permisos del caller para fallback. */
	perms: Permission[];
}

/** ¿Puede crear proyectos públicos? Solo admin global o PM.WRITE global. */
export function canCreatePublicProject({ isAdmin, orgId, perms }: ProjectCreatePerms): boolean {
	if (isAdmin) return true;
	return !orgId && canWrite(perms, PMScopes.PROJECTS);
}

/** ¿Puede crear proyectos de organización? Admin global, admin de org, o PM de org (con PROJECTS.WRITE formal). */
export function canCreateOrgProject({ isAdmin, isOrgAdmin, orgId, perms }: ProjectCreatePerms): boolean {
	if (isAdmin || isOrgAdmin) return true;
	return !!orgId && canWrite(perms, PMScopes.PROJECTS);
}

/**
 * Un miembro puede eliminar un proyecto si:
 *  - tiene permiso formal PM.DELETE, o
 *  - es owner del proyecto y éste es privado (cuota personal).
 */
export function canDeleteProject(perms: Permission[], project: Project | null | undefined, caller?: CallerCtx): boolean {
	if (!project) return false;
	if (canDelete(perms, PMScopes.PROJECTS, { selfId: caller?.userId, ownerId: project.ownerId })) return true;
	return project.visibility === "private" && !!caller?.userId && project.ownerId === caller.userId;
}

/**
 * Un issue puede ser actualizado si el usuario tiene permiso formal UPDATE o si
 * es asignado al issue. (Los logs son inmutables por contrato del backend.)
 */
export function canUpdateIssue(perms: Permission[], project: Project | null, issue: Issue | null, caller?: CallerCtx): boolean {
	if (isIssueAssignee(issue, caller)) return true;
	return canUpdate(perms, PMScopes.ISSUES, { selfId: caller?.userId, ownerId: issue?.reporterId ?? project?.ownerId });
}

/** `true` si el caller es el owner del proyecto. */
function isProjectOwner(project: Project | null | undefined, caller?: CallerCtx): boolean {
	return !!project && !!caller?.userId && project.ownerId === caller.userId;
}

/**
 * Espejo del `projectOwnerAllowIf` del backend: el owner del proyecto puede
 * escribir/actualizar/eliminar recursos del mismo (sprints, milestones, issues
 * y settings del proyecto) sin necesidad de permiso formal.
 */
export function canWriteProjectResource(perms: Permission[], scope: number, project: Project | null | undefined, caller?: CallerCtx): boolean {
	if (isProjectOwner(project, caller)) return true;
	return canWrite(perms, scope, { selfId: caller?.userId, ownerId: project?.ownerId });
}

export function canUpdateProjectResource(perms: Permission[], scope: number, project: Project | null | undefined, caller?: CallerCtx): boolean {
	if (isProjectOwner(project, caller)) return true;
	return canUpdate(perms, scope, { selfId: caller?.userId, ownerId: project?.ownerId });
}

export function canDeleteProjectResource(perms: Permission[], scope: number, project: Project | null | undefined, caller?: CallerCtx): boolean {
	if (isProjectOwner(project, caller)) return true;
	return canDelete(perms, scope, { selfId: caller?.userId, ownerId: project?.ownerId });
}
