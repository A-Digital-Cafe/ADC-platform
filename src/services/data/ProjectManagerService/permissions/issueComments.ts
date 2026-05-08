/**
 * Permission checker compartido para comentarios de issues del Project Manager.
 *
 * El `CommentsManager` se construye con un único checker; este expone una
 * función que evalúa el acceso usando el contexto enriquecido por el endpoint
 * (proyecto, issue, membresía, flags PM globales).
 */
import type { CommentPermissionChecker } from "../../../../utilities/comments/comments-utility/index.js";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import { isProjectMember, isProjectAccessibleInOrgContext } from "../utils/project-access.ts";
import type { PMCtx } from "../dao/projects.ts";

export interface IssueCommentEndpointCtx {
	userId: string;
	authorName?: string;
	authorImage?: string;
	tokenOrgId: string | null;
	project: Project;
	issue: Issue;
	pmCtx: PMCtx;
}

function isAssignee(issue: Issue, userId: string, groupIds: string[]): boolean {
	if (issue.assigneeIds?.includes(userId)) return true;
	return issue.assigneeGroupIds?.some((gid) => groupIds.includes(gid)) ?? false;
}

/**
 * Construye el checker para issue-comments. Reglas:
 * - `list`: miembro del proyecto, reporter, assignee, owner del proyecto o
 *   admin/PM global o de la org.
 * - `create` / `reply`: igual a `list` (escritura de comentarios).
 * - `react`: igual a `list`.
 * - `edit`: solo el autor del comentario.
 * - `delete`: el autor o el owner del proyecto / admin global / org admin.
 * - `moderate`: owner del proyecto o admin global / org admin.
 *
 * Todas las acciones requieren que el proyecto sea accesible en el contexto de
 * org (token-orgId vs project-orgId).
 */
export const issueCommentsChecker: CommentPermissionChecker = async (action, ctx, comment) => {
	const c = ctx as IssueCommentEndpointCtx;
	if (!c.project || !c.issue) return false;
	if (!isProjectAccessibleInOrgContext(c.project, c.tokenOrgId)) return false;

	const groupIds = c.pmCtx.groupIds;
	const isOwner = c.project.ownerId === c.userId;
	const isMember = isProjectMember(c.project, { id: c.userId, groupIds }, c.tokenOrgId);
	const isReporter = c.issue.reporterId === c.userId;
	const isIssueAssignee = isAssignee(c.issue, c.userId, groupIds);
	const isAdmin =
		c.pmCtx.isGlobalAdmin || c.pmCtx.hasGlobalPMWrite || (c.project.orgId ? await c.pmCtx.isOrgAdminOrPM(c.project.orgId) : false);

	const baseAccess = isOwner || isMember || isReporter || isIssueAssignee || isAdmin;

	switch (action) {
		case "list":
		case "create":
		case "reply":
		case "react":
			return baseAccess;
		case "edit":
			return !!comment && comment.authorId === c.userId;
		case "delete":
			if (!comment) return false;
			return comment.authorId === c.userId || isOwner || isAdmin;
		case "moderate":
			return isOwner || isAdmin;
		default:
			return false;
	}
};
