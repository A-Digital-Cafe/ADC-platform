import { BaseApp } from "../../BaseApp.js";
import type SEOService from "../../../services/data/SEOService/index.js";

/**
 * ADC Project Manager App - Panel de gestión de proyectos tipo Jira
 */
export default class AdcProjectManagerApp extends BaseApp {
	async run(): Promise<void> {
		try {
			const seo = this.getMyService<SEOService>("SEOService");
			const hosting = this.config?.uiModule?.hosting;
			seo.registerOnSitemap({
				appName: this.name,
				hosting,
				appDir: this.appDir,
				paths: [{ path: "/", changefreq: "monthly", priority: 0.6 }],
			});
			seo.registerPageMeta({
				appName: this.name,
				hosting,
				defaults: { robots: "noindex,nofollow", og: { siteName: "Abby's Digital Cafe" } },
				pages: [
					{
						path: "/",
						meta: {
							title: "Gestión de proyectos",
							titleTemplate: "%s · ADC",
							description: "Gestiona tus proyectos y tareas en Abby's Digital Cafe.",
						},
					},
				],
			});
		} catch (e) {
			this.logger.logDebug(`SEOService no disponible: ${(e as Error).message}`);
		}
		this.logger.logOk("ADC Project Manager App iniciada");
	}
}
