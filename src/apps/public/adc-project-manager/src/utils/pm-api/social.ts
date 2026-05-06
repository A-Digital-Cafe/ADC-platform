import { createCommentsApi } from "@ui-library/utils/api-comments";
import { createAttachmentsApi } from "@ui-library/utils/api-attachments";
import { api } from "./client.ts";

const forIssue = (issueId: string) => {
	const prefix = `/issues/${issueId}`;
	const scope = `pm:${issueId}`;
	return {
		c: createCommentsApi(api, prefix, scope),
		a: createAttachmentsApi(api, prefix, scope),
	};
};

type C = ReturnType<typeof createCommentsApi>;
type A = ReturnType<typeof createAttachmentsApi>;

export const issueCommentsApi = {
	listIssueComments: (id: string, opts: Parameters<C["list"]>[0] = {}) => forIssue(id).c.list(opts),
	getIssueCommentThread: (id: string, root: string, opts: Parameters<C["thread"]>[1] = {}) => forIssue(id).c.thread(root, opts),
	countIssueComments: (id: string) => forIssue(id).c.count(),
	createIssueComment: (id: string, data: Parameters<C["create"]>[0]) => forIssue(id).c.create(data),
	updateIssueComment: (id: string, cid: string, data: Parameters<C["update"]>[1]) => forIssue(id).c.update(cid, data),
	deleteIssueComment: (id: string, cid: string) => forIssue(id).c.remove(cid),
	reactIssueComment: (id: string, cid: string, emoji: string) => forIssue(id).c.react(cid, emoji),
	unreactIssueComment: (id: string, cid: string, emoji: string) => forIssue(id).c.unreact(cid, emoji),
	getIssueCommentDraft: (id: string, opts: Parameters<C["getDraft"]>[0] = {}) => forIssue(id).c.getDraft(opts),
	saveIssueCommentDraft: (id: string, data: Parameters<C["saveDraft"]>[0]) => forIssue(id).c.saveDraft(data),
	deleteIssueCommentDraft: (id: string, opts: Parameters<C["deleteDraft"]>[0] = {}) => forIssue(id).c.deleteDraft(opts),
};

export const issueAttachmentsApi = {
	listIssueAttachments: (id: string, opts: Parameters<A["list"]>[0] = {}) => forIssue(id).a.list(opts),
	presignIssueAttachment: (id: string, data: Parameters<A["presign"]>[0]) => forIssue(id).a.presign(data),
	confirmIssueAttachment: (id: string, aid: string) => forIssue(id).a.confirm(aid),
	getIssueAttachmentDownloadUrl: (id: string, aid: string, opts: Parameters<A["downloadUrl"]>[1] = {}) =>
		forIssue(id).a.downloadUrl(aid, opts),
	deleteIssueAttachment: (id: string, aid: string) => forIssue(id).a.remove(aid),
};
