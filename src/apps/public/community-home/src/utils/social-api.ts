import { createAdcApi } from "@ui-library/utils/adc-fetch";
import { createCommentsApi } from "@ui-library/utils/api-comments";
import { createAttachmentsApi } from "@ui-library/utils/api-attachments";
import type { RatingStats } from "@common/ADC/types/community.js";
import type { Block } from "@common/ADC/types/learning.js";
import type { Comment, CommentDraft, CommentLabel, CommentsPage } from "@common/types/comments/Comment.js";
import type { AttachmentDTO } from "@common/types/attachments/Attachment.js";

export type { Comment, CommentDraft, CommentsPage, RatingStats };
export { buildCommentsTree, type CommentTreeNode } from "@ui-library/utils/comments-tree";
export type { PresignUploadResult } from "@ui-library/utils/api-attachments";

const api = createAdcApi({ basePath: "/api/learning", devPort: 3000, credentials: "include" });

const forArticle = (slug: string) => {
	const prefix = `/articles/${slug}`;
	return {
		c: createCommentsApi(api, prefix, slug),
		a: createAttachmentsApi(api, prefix, slug),
	};
};

const unwrap = <T, F>(p: Promise<{ success: boolean; data?: T }>, fallback: F): Promise<T | F> =>
	p.then((r) => (r.data === undefined ? fallback : (r.data as T)));

export const socialApi = {
	listComments: (slug: string, opts: { parentId?: string | null; cursor?: string | null; limit?: number } = {}) =>
		unwrap<CommentsPage, CommentsPage>(forArticle(slug).c.list(opts), { items: [], nextCursor: null }),
	getThread: (slug: string, rootId: string, opts: { cursor?: string | null; limit?: number } = {}) =>
		unwrap<CommentsPage, CommentsPage>(forArticle(slug).c.thread(rootId, opts), { items: [], nextCursor: null }),
	countComments: (slug: string) =>
		forArticle(slug)
			.c.count()
			.then((r) => r.data?.total ?? 0),
	createComment: (slug: string, input: { blocks: Block[]; parentId?: string | null; attachmentIds?: string[]; label?: CommentLabel }) =>
		unwrap<Comment, null>(forArticle(slug).c.create(input), null),
	updateComment: (slug: string, commentId: string, input: { blocks: Block[]; attachmentIds?: string[] }) =>
		unwrap<Comment, null>(forArticle(slug).c.update(commentId, input), null),
	deleteComment: (slug: string, commentId: string) =>
		forArticle(slug)
			.c.remove(commentId)
			.then((r) => r.data?.success === true),
	reactComment: (slug: string, commentId: string, emoji: string) => unwrap<Comment, null>(forArticle(slug).c.react(commentId, emoji), null),
	unreactComment: (slug: string, commentId: string, emoji: string) =>
		unwrap<Comment, null>(forArticle(slug).c.unreact(commentId, emoji), null),

	getDraft: (slug: string, opts: { parentId?: string | null; editingCommentId?: string | null } = {}) =>
		forArticle(slug)
			.c.getDraft(opts)
			.then((r) => r.data?.draft ?? null),
	saveDraft: (
		slug: string,
		input: { blocks: Block[]; attachmentIds?: string[]; parentId?: string | null; editingCommentId?: string | null }
	) => unwrap<CommentDraft, null>(forArticle(slug).c.saveDraft(input), null),
	deleteDraft: (slug: string, opts: { parentId?: string | null; editingCommentId?: string | null } = {}) =>
		forArticle(slug)
			.c.deleteDraft(opts)
			.then((r) => r.data?.ok === true),

	listAttachments: (slug: string, opts: { includePending?: boolean; limit?: number } = {}) =>
		unwrap<AttachmentDTO[], AttachmentDTO[]>(forArticle(slug).a.list(opts), []),
	presignAttachment: (slug: string, input: { fileName: string; mimeType: string; size: number; forComment?: boolean }) =>
		forArticle(slug)
			.a.presign(input)
			.then((r) => r.data ?? null),
	confirmAttachment: (slug: string, attachmentId: string) =>
		forArticle(slug)
			.a.confirm(attachmentId)
			.then((r) => r.data ?? null),
	getAttachmentDownloadUrl: (slug: string, attachmentId: string, opts: { inline?: boolean; ttl?: number } = {}) =>
		forArticle(slug)
			.a.downloadUrl(attachmentId, opts)
			.then((r) => r.data ?? null),
	deleteAttachment: (slug: string, attachmentId: string) =>
		forArticle(slug)
			.a.remove(attachmentId)
			.then((r) => r.data?.success === true),

	getRating: (slug: string) =>
		api.get<RatingStats>(`/articles/${slug}/rating`).then((r) => r.data ?? { average: 0, count: 0, myRating: null }),
	rate: (slug: string, value: number) =>
		api
			.post<{ success: boolean }>(`/articles/${slug}/rating`, {
				body: { value },
				idempotencyKey: crypto.randomUUID(),
			})
			.then((r) => r.data?.success === true),
};
