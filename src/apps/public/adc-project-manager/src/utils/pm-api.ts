import { projectsApi } from "./pm-api/projects.ts";
import { sprintsApi, milestonesApi } from "./pm-api/sprints.ts";
import { issuesApi } from "./pm-api/issues.ts";
import { issueCommentsApi, issueAttachmentsApi, issueDescriptionApi } from "./pm-api/social.ts";

export const pmApi = {
	...projectsApi,
	...sprintsApi,
	...milestonesApi,
	...issuesApi,
	...issueCommentsApi,
	...issueAttachmentsApi,
	...issueDescriptionApi,
};

export type { IssueListParams } from "./pm-api/client.ts";
export { buildCommentsTree, type CommentTreeNode } from "@ui-library/utils/comments-tree";
export type { Comment } from "@common/types/comments/Comment.ts";
