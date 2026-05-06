/**
 * Permission checker compartido para attachments de issues del Project Manager.
 */
import type { AttachmentPermissionChecker } from "../../../../utilities/attachments/attachments-utility/index.js";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import { isProjectAccessibleInOrgContext, isProjectMember } from "../utils/project-access.ts";
import type { PMCtx } from "../dao/projects.ts";

export interface IssueAttachmentEndpointCtx {
	userId: string;
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
 * Reglas:
 * - `read`: miembro/reporter/assignee/owner del proyecto, admin global o de la org.
 * - `write`: igual que `read` (cualquier usuario con acceso al issue puede subir).
 * - `delete`: el uploader, owner del proyecto o admin.
 */
export const issueAttachmentsChecker: AttachmentPermissionChecker = async (action, ctx, attachment) => {
	const c = ctx as IssueAttachmentEndpointCtx;
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
		case "read":
		case "upload":
			return baseAccess;
		case "delete":
			if (!attachment) return baseAccess;
			return attachment.uploadedBy === c.userId || isOwner || isAdmin;
		default:
			return false;
	}
};
