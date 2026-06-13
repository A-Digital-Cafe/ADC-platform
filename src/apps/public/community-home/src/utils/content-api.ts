import type { LearningPath, Article } from "@ui-library/utils/connect-rpc";
import { createAdcApi } from "@ui-library/utils/adc-fetch";

// Re-exportar tipos para uso en componentes
export type { LearningPath, Article, PathItemLevel } from "@ui-library/utils/connect-rpc";

interface ListPathsOptions {
	public?: boolean;
	listed?: boolean;
	limit?: number;
	skip?: number;
}

interface ListArticlesOptions {
	pathSlug?: string;
	listed?: boolean;
	q?: string;
	limit?: number;
	start?: number;
	authorId?: string;
}

interface ListPathsResponse {
	paths: LearningPath[];
}

interface GetPathResponse {
	path: LearningPath;
}

interface ListArticlesResponse {
	articles: Article[];
	total: number;
	start: number;
	limit: number;
}

export interface ListArticlesResult {
	articles: Article[];
	total: number;
	start: number;
	limit: number;
}

interface GetArticleResponse {
	article: Article;
}

/**
 * Content API client using createAdcApi
 * - No credentials needed for public content
 * - Automatic error handling via adc-custom-error
 */
const api = createAdcApi({
	basePath: "/api/learning",
	devPort: 3000,
});

export const contentAPI = {
	listPaths: async (options?: ListPathsOptions): Promise<LearningPath[]> => {
		const result = await api.get<ListPathsResponse>("/paths", { params: options as Record<string, string | number | boolean | undefined> });
		return result.data?.paths ?? [];
	},

	getPath: async (slug: string): Promise<LearningPath | undefined> => {
		const result = await api.get<GetPathResponse>(`/paths/${slug}`);
		return result.data?.path;
	},

	listArticles: async (options?: ListArticlesOptions): Promise<ListArticlesResult> => {
		const result = await api.get<ListArticlesResponse>("/articles", {
			params: options as Record<string, string | number | boolean | undefined>,
		});
		return {
			articles: result.data?.articles ?? [],
			total: result.data?.total ?? 0,
			start: result.data?.start ?? 0,
			limit: result.data?.limit ?? 30,
		};
	},

	getArticle: async (slug: string): Promise<Article | undefined> => {
		const result = await api.get<GetArticleResponse>(`/articles/${slug}`);
		return result.data?.article;
	},
};

interface ContentLinkInfo {
	title?: string;
	/** Status HTTP del fetch (401/403 → sin acceso, 404 → inexistente). */
	status?: number;
}

/**
 * Resuelve sólo el título (y el status HTTP) de un artículo/ruta para el chip
 * `adc-platform-link`. Usa `silent` para no disparar toasts globales: el chip
 * degrada a "sin acceso" (401/403) o "inexistente" (404) por su cuenta. El
 * backend ya oculta borradores (`listed:false`) y rutas privadas (`public:false`)
 * a quien no es su autor / no tiene el rol, devolviendo 403.
 */
export const contentLinkAPI = {
	getArticle: async (slug: string): Promise<ContentLinkInfo> => {
		const r = await api.get<GetArticleResponse>(`/articles/${slug}`, { silent: true });
		return { title: r.data?.article?.title, status: r.status };
	},
	getPath: async (slug: string): Promise<ContentLinkInfo> => {
		const r = await api.get<GetPathResponse>(`/paths/${slug}`, { silent: true });
		return { title: r.data?.path?.title, status: r.status };
	},
};
