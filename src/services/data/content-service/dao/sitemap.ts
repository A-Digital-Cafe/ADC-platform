import type { Model } from "mongoose";
import type { Article, LearningPath } from "../../../../common/ADC/types/learning.js";

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

interface ArticleLean {
	slug: string;
	title: string;
	description?: string;
	image?: { url: string; alt?: string };
	authorId?: string;
	pathSlug?: string;
	createdAt?: Date;
	updatedAt?: Date;
}

interface PathLean {
	slug: string;
	title: string;
	description?: string;
	banner?: { url: string; alt?: string };
	updatedAt?: Date;
}

/**
 * DAO de sitemap/SEO: una única query batched por colección. Las versiones
 * "BySlug" o solo-slug se derivan en memoria desde estos resultados.
 */
export class SitemapDao {
	constructor(
		private readonly articleModel: Model<Article>,
		private readonly pathModel: Model<LearningPath>,
	) {}

	async listAllArticleSEO(): Promise<ArticleSEO[]> {
		const docs = await this.articleModel
			.find({ listed: true })
			.select({ slug: 1, title: 1, description: 1, image: 1, authorId: 1, pathSlug: 1, createdAt: 1, updatedAt: 1, _id: 0 })
			.lean<ArticleLean[]>();
		return docs
			.filter((d) => !!d.slug)
			.map((d) => ({
				slug: d.slug,
				title: d.title,
				description: d.description,
				imageUrl: d.image?.url,
				imageAlt: d.image?.alt,
				authorId: d.authorId,
				pathSlug: d.pathSlug,
				createdAt: d.createdAt,
				updatedAt: d.updatedAt,
			}));
	}

	async listAllPathSEO(): Promise<PathSEO[]> {
		const docs = await this.pathModel
			.find({ listed: true, public: true })
			.select({ slug: 1, title: 1, description: 1, banner: 1, updatedAt: 1, _id: 0 })
			.lean<PathLean[]>();
		return docs
			.filter((d) => !!d.slug)
			.map((d) => ({
				slug: d.slug,
				title: d.title,
				description: d.description,
				imageUrl: d.banner?.url,
				imageAlt: d.banner?.alt,
				updatedAt: d.updatedAt,
			}));
	}
}
