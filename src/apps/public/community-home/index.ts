import { AppWithSeo } from "../../AppWithSeo.js";
import type { PageMeta } from "../../../common/types/SEO/Service.js";
import type { IContentService } from "@common/types/community/ContentService.js";
import { buildArticleGraph, buildPageGraph } from "./seo-jsonld.js";

/**
 * Community Home - Página principal de la comunidad ADC
 */
export default class CommunityHomeApp extends AppWithSeo {
	async run() {
		let content: IContentService;
		try {
			content = this.getMyService<IContentService>("content-service");
		} catch (e) {
			this.logger.logDebug(`content-service no disponible: ${(e as Error).message}`);
			this.logger.logOk(`${this.name} ejecutándose`);
			return;
		}

		this.registerSeo({
			sitemap: {
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
			},
			llms: {
				title: "Abby's Digital Cafe",
				description:
					"Comunidad para programadores y estudiantes, enfocada en aprender nuevas tecnologías y compartir código de forma libre.",
				sections: async ({ origin }) => {
					const [articleSlugs, pathSlugs] = await Promise.all([content.listPublishedArticleSlugs(), content.listPublishedPathSlugs()]);
					const [articles, paths] = await Promise.all([
						Promise.all(articleSlugs.slice(0, 50).map((a) => content.getArticleSEOBySlug(a.slug))),
						Promise.all(pathSlugs.slice(0, 20).map((p) => content.getPathSEOBySlug(p.slug))),
					]);
					return [
						{
							title: "Artículos recientes",
							description: "Selección curada para LLMs.",
							links: articles
								.filter((a): a is NonNullable<typeof a> => !!a)
								.map((a) => ({
									title: a.title,
									description: a.description ?? `Guía práctica para aprender ${a.title} paso a paso`,
									href: `${origin}/articles/${a.slug}`,
								})),
						},
						{
							title: "Learning Paths",
							description: "Rutas de aprendizaje destacadas.",
							links: paths
								.filter((p): p is NonNullable<typeof p> => !!p)
								.map((p) => ({
									title: p.title,
									description: p.description ?? `Ruta de ${p.title} desde fundamentos hasta nivel avanzado`,
									href: `${origin}/paths/${p.slug}`,
								})),
						},
					];
				},
			},
			pageMeta: {
				defaults: {
					titleTemplate: "%s · ADC",
					og: { siteName: "Abby's Digital Cafe", locale: "es_ES", type: "website" },
					twitter: { card: "summary_large_image" },
					ogBrand: {
						background: "#fef0cb",
						color: "#5d3a2f",
						brandName: "Abby's Digital Cafe",
					},
				},
				pages: [
					{
						path: "/",
						meta: {
							title: "Comunidad",
							description: "Aprende, comparte y descubre rutas de aprendizaje en Abby's Digital Cafe.",
							jsonLd: buildPageGraph(
								"/",
								"Comunidad",
								"Aprende, comparte y descubre rutas de aprendizaje en Abby's Digital Cafe."
							),
						},
					},
					{
						path: "/paths",
						meta: {
							title: "Rutas de aprendizaje",
							description: "Explora todas las rutas de aprendizaje publicadas en la comunidad de ADC.",
							jsonLd: buildPageGraph(
								"/paths",
								"Rutas de aprendizaje",
								"Explora todas las rutas de aprendizaje publicadas en la comunidad de ADC."
							),
						},
					},
					{
						path: "/articles",
						meta: {
							title: "Artículos",
							description: "Artículos publicados por la comunidad de Abby's Digital Cafe.",
							jsonLd: buildPageGraph("/articles", "Artículos", "Artículos publicados por la comunidad de Abby's Digital Cafe."),
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
								jsonLd: buildPageGraph(`/paths/${params.slug}`, seoData.title, seoData.description),
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
								jsonLd: buildArticleGraph({
									path: `/articles/${params.slug}`,
									title: seoData.title,
									description: seoData.description,
									imageUrl: seoData.imageUrl,
									createdAt: seoData.createdAt,
									updatedAt: seoData.updatedAt,
									section: seoData.pathSlug,
								}),
							};
						},
					},
				],
			},
		});
		this.logger.logOk(`${this.name} ejecutándose`);
	}
}
