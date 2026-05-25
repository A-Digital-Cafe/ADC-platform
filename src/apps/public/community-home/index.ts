import { BaseApp } from "../../BaseApp.js";
import type SEOService from "../../../services/data/SEOService/index.js";
import type { PageMeta } from "../../../services/data/SEOService/index.js";
import type ContentService from "../../../services/data/content-service/index.js";

/**
 * Community Home - Página principal de la comunidad ADC
 */
export default class CommunityHomeApp extends BaseApp {
	async run() {
		try {
			const seo = this.getMyService<SEOService>("SEOService");
			const content = this.getMyService<ContentService>("content-service");
			const hosting = this.config?.uiModule?.hosting;

			seo.registerOnSitemap({
				appName: this.name,
				hosting,
				appDir: this.appDir,
				paths: async () => {
					const [articles, paths] = await Promise.all([content.listPublishedArticleSlugs(), content.listPublishedPathSlugs()]);
					return [
						{ path: "/", changefreq: "monthly", priority: 0.9 },
						{ path: "/paths", changefreq: "monthly", priority: 0.8 },
						{ path: "/articles", changefreq: "weekly", priority: 0.8 },
						...paths.map((p) => ({ path: `/paths/${p.slug}`, lastmod: p.updatedAt, changefreq: "weekly" as const, priority: 0.7 })),
						...articles.map((a) => ({
							path: `/articles/${a.slug}`,
							lastmod: a.updatedAt,
							changefreq: "weekly" as const,
							priority: 0.6,
						})),
					];
				},
			});

			seo.registerPageMeta({
				appName: this.name,
				hosting,
				defaults: {
					titleTemplate: "%s · ADC",
					og: { siteName: "Abby's Digital Cafe", locale: "es_ES", type: "website" },
					twitter: { card: "summary_large_image" },
				},
				pages: [
					{
						path: "/",
						meta: {
							title: "Comunidad",
							description: "Aprende, comparte y descubre rutas de aprendizaje en Abby's Digital Cafe.",
						},
					},
					{
						path: "/paths",
						meta: {
							title: "Rutas de aprendizaje",
							description: "Explora todas las rutas de aprendizaje publicadas en la comunidad de ADC.",
						},
					},
					{
						path: "/articles",
						meta: {
							title: "Artículos",
							description: "Artículos publicados por la comunidad de Abby's Digital Cafe.",
						},
					},
					{
						path: "/paths/:slug",
						meta: async ({ params }): Promise<PageMeta | null> => {
							const seoData = await content.getPathSEOBySlug(params.slug);
							if (!seoData) return null;
							return {
								title: seoData.title,
								description: seoData.description,
								og: {
									type: "website",
									title: seoData.title,
									description: seoData.description,
									image: seoData.imageUrl ? { url: seoData.imageUrl, alt: seoData.imageAlt } : undefined,
								},
								twitter: {
									card: "summary_large_image",
									title: seoData.title,
									description: seoData.description,
									image: seoData.imageUrl,
								},
							};
						},
					},
					{
						path: "/articles/:slug",
						meta: async ({ params }): Promise<PageMeta | null> => {
							const seoData = await content.getArticleSEOBySlug(params.slug);
							if (!seoData) return null;
							return {
								title: seoData.title,
								description: seoData.description,
								og: {
									type: "article",
									title: seoData.title,
									description: seoData.description,
									image: seoData.imageUrl ? { url: seoData.imageUrl, alt: seoData.imageAlt } : undefined,
								},
								twitter: {
									card: "summary_large_image",
									title: seoData.title,
									description: seoData.description,
									image: seoData.imageUrl,
								},
								article: {
									publishedTime: seoData.createdAt,
									modifiedTime: seoData.updatedAt,
									author: seoData.authorId,
									section: seoData.pathSlug,
								},
							};
						},
					},
				],
			});
		} catch (e) {
			this.logger.logDebug(`SEOService no disponible: ${(e as Error).message}`);
		}
		this.logger.logOk(`${this.name} ejecutándose`);
	}
}
