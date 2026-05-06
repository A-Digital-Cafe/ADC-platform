import { projectsApi } from "./pm-api/projects.ts";
import { sprintsApi, milestonesApi } from "./pm-api/sprints.ts";
import { issuesApi } from "./pm-api/issues.ts";
import { issueCommentsApi, issueAttachmentsApi } from "./pm-api/social.ts";

export const pmApi = {
	...projectsApi,
	...sprintsApi,
	...milestonesApi,
	...issuesApi,
	...issueCommentsApi,
	...issueAttachmentsApi,
};

export type { IssueListParams } from "./pm-api/client.ts";
export { buildCommentsTree, type CommentTreeNode } from "@ui-library/utils/comments-tree";
export type { Comment, CommentDraft, CommentsPage } from "@common/types/comments/Comment.ts";
export type { AttachmentDTO } from "@common/types/attachments/Attachment.ts";
