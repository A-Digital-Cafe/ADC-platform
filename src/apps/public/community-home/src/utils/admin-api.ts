import { createAdcApi } from "@ui-library/utils/adc-fetch";
import type { Article, LearningPath, Block, PathItemLevel } from "@ui-library/utils/connect-rpc";

const api = createAdcApi({
	basePath: "/api/learning",
	devPort: 3000,
	credentials: "include",
});

export interface ArticlePayload {
	slug?: string;
	title?: string;
	pathSlug?: string;
	blocks?: Block[];
	videoUrl?: string;
	image?: { url: string; width?: number; height?: number; alt?: string };
	description?: string;
	listed?: boolean;
}

export interface PathPayload {
	slug?: string;
	title?: string;
	description?: string;
	color?: string;
	banner?: { url: string; width?: number; height?: number; alt?: string };
	public?: boolean;
	listed?: boolean;
	items?: Array<{ slug: string; type: "article" | "path"; level?: PathItemLevel }>;
}

export const adminApi = {
	createArticle: async (body: ArticlePayload): Promise<Article | null> => {
		const r = await api.post<{ article: Article }>("/articles", { body, idempotencyData: { action: "create-article", ...body } });
		return r.data?.article ?? null;
	},
	updateArticle: async (slug: string, body: ArticlePayload): Promise<Article | null> => {
		const r = await api.put<{ article: Article }>(`/articles/${slug}`, {
			body,
			idempotencyData: { action: "update-article", slug, ...body },
		});
		return r.data?.article ?? null;
	},
	deleteArticle: async (slug: string): Promise<boolean> => {
		const r = await api.delete<{ success: boolean }>(`/articles/${slug}`, { idempotencyKey: `delete-article:${slug}` });
		return r.data?.success === true;
	},

	createPath: async (body: PathPayload): Promise<LearningPath | null> => {
		const r = await api.post<{ path: LearningPath }>("/paths", { body, idempotencyData: { action: "create-path", ...body } });
		return r.data?.path ?? null;
	},
	updatePath: async (slug: string, body: PathPayload): Promise<LearningPath | null> => {
		const r = await api.put<{ path: LearningPath }>(`/paths/${slug}`, { body, idempotencyData: { action: "update-path", slug, ...body } });
		return r.data?.path ?? null;
	},
	deletePath: async (slug: string): Promise<boolean> => {
		const r = await api.delete<{ success: boolean }>(`/paths/${slug}`, { idempotencyKey: `delete-path:${slug}` });
		return r.data?.success === true;
	},
};

interface BannerPresignResult {
	attachmentId: string;
	uploadUrl: string;
	headers: Record<string, string>;
}

/** URL pública (raw) del banner de un path, servida por content-service. */
export function pathBannerRawUrl(slug: string): string {
	return `/api/learning/paths/${encodeURIComponent(slug)}/banner/raw`;
}

export const pathBannerApi = {
	/** Sube un banner para un path existente: presign → PUT a S3 → confirm. */
	upload: async (slug: string, file: File): Promise<boolean> => {
		const presign = await api.post<BannerPresignResult>(`/paths/${slug}/banner/presign-upload`, {
			body: { fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size },
			idempotencyKey: `path-banner-presign:${slug}:${file.size}:${Date.now()}`,
		});
		if (!presign.data) return false;
		const putRes = await fetch(presign.data.uploadUrl, { method: "PUT", body: file, headers: presign.data.headers });
		if (!putRes.ok) return false;
		const confirmed = await api.post<{ attachment: { id: string } }>(`/paths/${slug}/banner/${presign.data.attachmentId}/confirm`, {
			idempotencyKey: `path-banner-confirm:${slug}:${presign.data.attachmentId}`,
		});
		return !!confirmed.data?.attachment?.id;
	},
	remove: async (slug: string): Promise<boolean> => {
		const r = await api.delete<{ success: boolean }>(`/paths/${slug}/banner`, { idempotencyKey: `path-banner-del:${slug}` });
		return r.data?.success === true;
	},
};

export type { Article, LearningPath, Block, PathItemLevel };
