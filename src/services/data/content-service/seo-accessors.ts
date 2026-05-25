import type { SitemapDao, PublishedSitemapSlug, ArticleSEO, PathSEO } from "./dao/sitemap.js";
import { SEOCache } from "./seo-cache.js";

const DEFAULT_TTL_MS = 5 * 60_000;

/**
 * Wrapper que agrupa la cache batched de SEO para artículos y paths.
 * Una sola query por colección refresca todos los slugs cada `ttlMs`.
 */
export class ContentSEOAccessors {
	readonly #articles: SEOCache<ArticleSEO>;
	readonly #paths: SEOCache<PathSEO>;

	constructor(dao: SitemapDao, ttlMs: number = DEFAULT_TTL_MS) {
		this.#articles = new SEOCache<ArticleSEO>(() => dao.listAllArticleSEO(), ttlMs);
		this.#paths = new SEOCache<PathSEO>(() => dao.listAllPathSEO(), ttlMs);
	}

	async listPublishedArticleSlugs(): Promise<PublishedSitemapSlug[]> {
		const all = await this.#articles.list();
		return all.map((a) => ({ slug: a.slug, updatedAt: a.updatedAt }));
	}

	async listPublishedPathSlugs(): Promise<PublishedSitemapSlug[]> {
		const all = await this.#paths.list();
		return all.map((p) => ({ slug: p.slug, updatedAt: p.updatedAt }));
	}

	getArticleSEOBySlug(slug: string): Promise<ArticleSEO | null> {
		return this.#articles.get(slug);
	}

	getPathSEOBySlug(slug: string): Promise<PathSEO | null> {
		return this.#paths.get(slug);
	}

	invalidate(): void {
		this.#articles.invalidate();
		this.#paths.invalidate();
	}
}
