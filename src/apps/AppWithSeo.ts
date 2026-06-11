import { BaseApp } from "./BaseApp.js";
import type { ISEOService, LlmsSectionsSource, PageMeta, PageMetaEntry, SitemapPathSource } from "../common/types/SEO/Service.js";

/**
 * Configuración SEO declarativa que las apps pasan a `registerSeo()`.
 *
 * - `sitemap.paths`: lista (o función async) de URLs propias de la app.
 * - `sitemap.isIndex`: marca los hosts como índices de sitemaps.
 * - `pageMeta.pages`: metadatos por ruta (estáticos o resolvers async).
 * - `pageMeta.defaults`: metadatos por defecto del host (og, twitter, etc.).
 * - `llms`: documento `/llms.txt` con secciones curadas para LLMs.
 */
export interface AppSeoConfig {
	sitemap?: {
		paths: SitemapPathSource;
		isIndex?: boolean;
	};
	pageMeta?: {
		pages: PageMetaEntry[];
		defaults?: PageMeta;
	};
	llms?: {
		title: string;
		description?: string;
		sections: LlmsSectionsSource;
		cacheTtlMs?: number;
	};
}

/**
 * App con soporte SEO opcional.
 *
 * Centraliza el patrón repetido en todos los `index.ts` de apps públicas:
 *   - lookup tolerante a fallos del `SEOService` (si el preset SEO no está
 *     instalado, la app sigue funcionando normalmente);
 *   - inyección automática de `appName`, `hosting` y `appDir` desde la
 *     configuración de la app y `BaseApp`.
 *
 * Si necesitás registrar más de una vez (por ejemplo, para combinar resolvers
 * dinámicos con páginas estáticas) podés invocar `registerSeo` varias veces:
 * el servicio fusiona registraciones por host idempotentemente.
 */
export abstract class AppWithSeo extends BaseApp {
	/**
	 * Registra metadata SEO de la app contra el `SEOService`. Si el servicio
	 * no está disponible (preset SEO no instalado o aún no cargado) se loguea
	 * en debug y se continúa.
	 */
	protected registerSeo(seoConfig: AppSeoConfig): void {
		if (!seoConfig.sitemap && !seoConfig.pageMeta && !seoConfig.llms) return;
		try {
			const seo = this.getMyService<ISEOService>("SEOService");
			const hosting = this.config?.uiModule?.hosting;
			if (seoConfig.sitemap) {
				seo.registerOnSitemap({
					appName: this.name,
					hosting,
					appDir: this.appDir,
					paths: seoConfig.sitemap.paths,
					isIndex: seoConfig.sitemap.isIndex,
				});
			}
			if (seoConfig.pageMeta) {
				seo.registerPageMeta({
					appName: this.name,
					hosting,
					pages: seoConfig.pageMeta.pages,
					defaults: seoConfig.pageMeta.defaults,
				});
			}
			if (seoConfig.llms) {
				seo.registerLlms({
					appName: this.name,
					hosting,
					title: seoConfig.llms.title,
					description: seoConfig.llms.description,
					sections: seoConfig.llms.sections,
					cacheTtlMs: seoConfig.llms.cacheTtlMs,
				});
			}
		} catch (e) {
			// Distinguir "servicio no registrado" (degradación esperada, debug) de un
			// error interno real del SEOService (warn: el sitio pierde sitemaps/OG sin avisar).
			const message = (e as Error).message ?? String(e);
			if (/no encontrado|not found|no registrado|not registered/i.test(message)) {
				this.logger.logDebug(`SEOService no disponible: ${message}`);
			} else {
				this.logger.logWarn(`SEOService falló durante el registro SEO de ${this.name}: ${message}`);
			}
		}
	}
}
