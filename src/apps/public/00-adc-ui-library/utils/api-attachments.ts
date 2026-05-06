import type { AttachmentDTO } from "@common/types/attachments/Attachment.js";
import type { AdcFetchResult } from "./adc-fetch.js";

type AdcApi = {
	get: <T>(path: string, opts?: { params?: Record<string, string | number | boolean | undefined | null> }) => Promise<AdcFetchResult<T>>;
	post: <T>(path: string, opts?: { body?: unknown; idempotencyKey?: string }) => Promise<AdcFetchResult<T>>;
	delete: <T>(path: string, opts?: { idempotencyKey?: string }) => Promise<AdcFetchResult<T>>;
};

export interface PresignUploadInput {
	fileName: string;
	mimeType: string;
	size: number;
	forComment?: boolean;
}
export interface PresignUploadResult {
	attachmentId: string;
	uploadUrl: string;
	key: string;
	bucket: string;
	headers: Record<string, string>;
	expiresAt: string;
}

/**
 * API genérica de attachments anclada a un recurso. `prefix` es el path completo
 * al recurso (ej. `/articles/${slug}` o `/issues/${id}`). `idScope` aporta un
 * sufijo único para construir idempotency keys.
 */
export function createAttachmentsApi(api: AdcApi, prefix: string, idScope: string) {
	const url = (suffix: string) => `${prefix}/attachments${suffix}`;
	return {
		list: (opts: { includePending?: boolean; limit?: number } = {}) => {
			const params: Record<string, string | number> = {};
			if (opts.includePending) params.includePending = "true";
			if (opts.limit) params.limit = opts.limit;
			return api.get<AttachmentDTO[]>(url(""), Object.keys(params).length ? { params } : undefined);
		},
		presign: (data: PresignUploadInput) =>
			api.post<PresignUploadResult>(url("/presign-upload"), {
				body: data,
				idempotencyKey: `${idScope}-presign:${data.fileName}:${data.size}:${Date.now()}`,
			}),
		confirm: (attachmentId: string) =>
			api.post<AttachmentDTO>(url(`/${attachmentId}/confirm`), {
				idempotencyKey: `${idScope}-confirm:${attachmentId}`,
			}),
		downloadUrl: (attachmentId: string, opts: { inline?: boolean; ttl?: number } = {}) => {
			const params: Record<string, string | number> = {};
			if (opts.inline) params.inline = "true";
			if (opts.ttl) params.ttl = opts.ttl;
			return api.get<{ url: string; expiresAt: string }>(
				url(`/${attachmentId}/download`),
				Object.keys(params).length ? { params } : undefined
			);
		},
		remove: (attachmentId: string) =>
			api.delete<{ success: boolean }>(url(`/${attachmentId}`), {
				idempotencyKey: `${idScope}-att-del:${attachmentId}`,
			}),
	};
}

export type AttachmentsApi = ReturnType<typeof createAttachmentsApi>;
