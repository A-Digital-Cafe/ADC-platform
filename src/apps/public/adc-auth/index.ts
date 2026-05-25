import { BaseApp } from "../../BaseApp.js";
import type SEOService from "../../../services/data/SEOService/index.js";

/**
 * ADC Auth App - Sistema de autenticación
 * Host app para login/register via SessionManagerService
 */
export default class AdcAuthApp extends BaseApp {
	async run(): Promise<void> {
		try {
			const seo = this.getMyService<SEOService>("SEOService");
			const hosting = this.config?.uiModule?.hosting;
			seo.registerOnSitemap({
				appName: this.name,
				hosting,
				appDir: this.appDir,
				paths: [
					{ path: "/login", changefreq: "monthly", priority: 0.7 },
					{ path: "/register", changefreq: "monthly", priority: 0.7 },
				],
			});
			seo.registerPageMeta({
				appName: this.name,
				hosting,
				defaults: {
					titleTemplate: "%s · ADC",
					og: { siteName: "Abby's Digital Cafe", locale: "es_ES", type: "website" },
					twitter: { card: "summary" },
					robots: "noindex,nofollow",
				},
				pages: [
					{
						path: "/login",
						meta: {
							title: "Iniciar sesión",
							description: "Inicia sesión en Abby's Digital Cafe para acceder a tus proyectos y comunidad.",
						},
					},
					{
						path: "/register",
						meta: {
							title: "Crear cuenta",
							description: "Únete a Abby's Digital Cafe y empieza a aprender y compartir con la comunidad.",
						},
					},
				],
			});
		} catch (e) {
			this.logger.logDebug(`SEOService no disponible: ${(e as Error).message}`);
		}
		this.logger.logOk("ADC Auth App iniciada");
	}
}
