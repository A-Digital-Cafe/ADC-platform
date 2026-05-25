import { BaseApp } from "../../BaseApp.js";
import type SEOService from "../../../services/data/SEOService/index.js";

/**
 * ADC Organization Management App - Gestión de organizaciones
 */
export default class AdcOrgManagementApp extends BaseApp {
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
							title: "Gestión de organizaciones",
							titleTemplate: "%s · ADC",
							description: "Administra organizaciones, miembros y permisos de tu cuenta.",
						},
					},
				],
			});
		} catch (e) {
			this.logger.logDebug(`SEOService no disponible: ${(e as Error).message}`);
		}
		this.logger.logOk("ADC Organization Management App started");
	}
}
