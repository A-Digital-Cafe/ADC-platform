import { BaseApp } from "../../BaseApp.js";
import type SEOService from "../../../services/data/SEOService/index.js";

/**
 * ADC Identity App - Panel de gestión de identidades
 * Administración de usuarios, roles, grupos, organizaciones y regiones
 */
export default class AdcIdentityApp extends BaseApp {
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
							title: "Gestión de identidad",
							titleTemplate: "%s · ADC",
							description: "Administra usuarios, roles, grupos, organizaciones y regiones.",
						},
					},
				],
			});
		} catch (e) {
			this.logger.logDebug(`SEOService no disponible: ${(e as Error).message}`);
		}
		this.logger.logOk("ADC Identity App iniciada");
	}
}
