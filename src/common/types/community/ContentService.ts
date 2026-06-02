/**
 * Contrato público del ContentService.
 *
 * Vive en `src/common/types/community/` para que las apps y el resto de servicios
 * del núcleo puedan referenciarlo sin depender físicamente del módulo `content-service`
 * (que vive como preset opcional en `presets/community-content/`).
 */

export interface PublishedSitemapSlug {
	slug: string;
	updatedAt?: Date;
}

export interface ArticleSEO {
	slug: string;
	title: string;
	description?: string;
	imageUrl?: string;
	imageAlt?: string;
	createdAt?: Date;
	updatedAt?: Date;
	authorId?: string;
	pathSlug?: string;
}

export interface PathSEO {
	slug: string;
	title: string;
	description?: string;
	imageUrl?: string;
	imageAlt?: string;
	updatedAt?: Date;
}

export interface IContentService {
	/** Devuelve solo slug + updatedAt de artículos publicados (batched + cache). */
	listPublishedArticleSlugs(): Promise<PublishedSitemapSlug[]>;

	/** Devuelve solo slug + updatedAt de learning paths publicados (batched + cache). */
	listPublishedPathSlugs(): Promise<PublishedSitemapSlug[]>;

	/** Datos mínimos para inyectar meta SEO de un artículo (hit a cache batched). */
	getArticleSEOBySlug(slug: string): Promise<ArticleSEO | null>;

	/** Datos mínimos para inyectar meta SEO de un learning path (hit a cache batched). */
	getPathSEOBySlug(slug: string): Promise<PathSEO | null>;
}
