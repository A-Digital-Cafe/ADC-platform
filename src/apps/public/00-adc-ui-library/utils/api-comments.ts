import type { Block } from "@common/ADC/types/learning.js";
import type { Comment, CommentDraft, CommentLabel, CommentsPage } from "@common/types/comments/Comment.js";
import type { AdcFetchResult } from "./adc-fetch.js";

type AdcApi = {
	get: <T>(
		path: string,
		opts?: { params?: Record<string, string | number | boolean | undefined | null>; silent?: boolean }
	) => Promise<AdcFetchResult<T>>;
	post: <T>(path: string, opts?: { body?: unknown; idempotencyKey?: string; idempotencyData?: unknown }) => Promise<AdcFetchResult<T>>;
	put: <T>(path: string, opts?: { body?: unknown; idempotencyKey?: string; idempotencyData?: unknown }) => Promise<AdcFetchResult<T>>;
	delete: <T>(
		path: string,
		opts?: { params?: Record<string, string | number | boolean | undefined | null>; idempotencyKey?: string }
	) => Promise<AdcFetchResult<T>>;
};

export interface CreateCommentInput {
	blocks: Block[];
	parentId?: string | null;
	attachmentIds?: string[];
	label?: CommentLabel;
}
export interface UpdateCommentInput {
	blocks: Block[];
	attachmentIds?: string[];
}
export interface DraftInput {
	blocks: Block[];
	attachmentIds?: string[];
	parentId?: string | null;
	editingCommentId?: string | null;
}
export interface DraftKey {
	parentId?: string | null;
	editingCommentId?: string | null;
}
export interface ListCommentsOpts extends DraftKey {
	cursor?: string | null;
	limit?: number;
	/** Suprime el toast de error (el caller maneja el fallo inline, p.ej. 403). */
	silent?: boolean;
}

function listParams(opts: ListCommentsOpts): Record<string, string | number> {
	const p: Record<string, string | number> = {};
	if (opts.parentId !== undefined) p.parentId = opts.parentId ?? "";
	if (opts.cursor) p.cursor = opts.cursor;
	if (opts.limit) p.limit = opts.limit;
	return p;
}

function draftParams(opts: DraftKey): Record<string, string> {
	const p: Record<string, string> = {};
	if (opts.parentId !== undefined) p.parentId = opts.parentId ?? "";
	if (opts.editingCommentId !== undefined) p.editingCommentId = opts.editingCommentId ?? "";
	return p;
}

/** Construye las opciones de un GET, omitiendo `params`/`silent` vacíos. */
function getOpts(
	params: Record<string, string | number>,
	silent?: boolean
): { params?: Record<string, string | number>; silent?: boolean } | undefined {
	const opts: { params?: Record<string, string | number>; silent?: boolean } = {};
	if (Object.keys(params).length) opts.params = params;
	if (silent) opts.silent = true;
	return Object.keys(opts).length ? opts : undefined;
}

/**
 * Construye la API de comentarios anclada a un recurso. `prefix` debe ser el
 * path completo al recurso (sin trailing slash). Ejemplo:
 *  - `/articles/${slug}` para community-home
 *  - `/issues/${issueId}` para project-manager
 */
export function createCommentsApi(api: AdcApi, prefix: string, _draftScope?: string) {
	const url = (suffix: string) => `${prefix}/comments${suffix}`;
	return {
		list: (opts: ListCommentsOpts = {}) => api.get<CommentsPage>(url(""), getOpts(listParams(opts), opts.silent)),
		thread: (rootId: string, opts: { cursor?: string | null; limit?: number } = {}) => {
			const params: Record<string, string | number> = {};
			if (opts.cursor) params.cursor = opts.cursor;
			if (opts.limit) params.limit = opts.limit;
			return api.get<CommentsPage>(url(`/threads/${rootId}`), Object.keys(params).length ? { params } : undefined);
		},
		count: () => api.get<{ total: number }>(url("/count")),
		create: (data: CreateCommentInput) => api.post<Comment>(url(""), { body: data, idempotencyData: data }),
		update: (commentId: string, data: UpdateCommentInput) =>
			api.put<Comment>(url(`/${commentId}`), { body: data, idempotencyKey: `${commentId}:update` }),
		remove: (commentId: string) => api.delete<{ success: boolean }>(url(`/${commentId}`), { idempotencyKey: `${commentId}:delete` }),
		react: (commentId: string, emoji: string) =>
			api.post<Comment>(url(`/${commentId}/reactions/${encodeURIComponent(emoji)}`), {
				idempotencyKey: `${commentId}:react:${encodeURIComponent(emoji)}`,
			}),
		unreact: (commentId: string, emoji: string) =>
			api.delete<Comment>(url(`/${commentId}/reactions/${encodeURIComponent(emoji)}`), {
				idempotencyKey: `${commentId}:unreact:${encodeURIComponent(emoji)}`,
			}),
		getDraft: (opts: DraftKey & { silent?: boolean } = {}) =>
			api.get<{ draft: CommentDraft | null }>(url("/draft"), getOpts(draftParams(opts), opts.silent)),
		saveDraft: (data: DraftInput) => api.put<CommentDraft>(url("/draft"), { body: data }),
		deleteDraft: (opts: DraftKey = {}) => {
			const params = draftParams(opts);
			return api.delete<{ ok: boolean }>(url("/draft"), Object.keys(params).length ? { params } : undefined);
		},
	};
}
