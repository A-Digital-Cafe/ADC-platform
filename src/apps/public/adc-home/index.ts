import { BaseApp } from "../../BaseApp.js";
import type SEOService from "../../../services/data/SEOService/index.js";

/**
 * ADC Home - Landing page para presentar los microfronts de Abby's Digital Cafe
 */
export default class AdcHomeApp extends BaseApp {
	async run() {
		try {
			const seo = this.getMyService<SEOService>("SEOService");
			const hosting = this.config?.uiModule?.hosting;
			seo.registerOnSitemap({
				appName: this.name,
				hosting,
				appDir: this.appDir,
				isIndex: true,
				paths: [{ path: "/", changefreq: "weekly", priority: 1 }],
			});
			seo.registerPageMeta({
				appName: this.name,
				hosting,
				defaults: {
					og: { siteName: "Abby's Digital Cafe", locale: "es_ES", type: "website" },
					twitter: { card: "summary_large_image" },
				},
				pages: [
					{
						path: "/",
						meta: {
							title: "Abby's Digital Cafe",
							titleTemplate: "%s",
							description:
								"Plataforma modular open-source para construir y orquestar productos digitales con arquitectura de microfrontends.",
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
