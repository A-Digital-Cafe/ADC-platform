import { BaseApp } from "../../BaseApp.js";
import type SEOService from "../../../services/data/SEOService/index.js";

/**
 * ADC Error App - Páginas de error de la plataforma
 *
 * Backend (SessionManager/OAuth/Moderation) redirige acá con un path
 * que identifica el tipo de error y query params con el detalle.
 */
export default class AdcErrorApp extends BaseApp {
	async run(): Promise<void> {
		try {
			const seo = this.getMyService<SEOService>("SEOService");
			const hosting = this.config?.uiModule?.hosting;
			seo.registerOnSitemap({
				appName: this.name,
				hosting,
				appDir: this.appDir,
				paths: [],
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
					{ path: "/", meta: { title: "Error", description: "Ha ocurrido un error" } },
					{ path: "/banned", meta: { title: "Acceso bloqueado", description: "Cuenta o IP baneada" } },
					{ path: "/csrf", meta: { title: "Error de seguridad", description: "Validación CSRF fallida" } },
					{ path: "/oauth", meta: { title: "Error de OAuth", description: "Error durante autenticación externa" } },
				],
			});
		} catch (e) {
			this.logger.logDebug(`SEOService no disponible: ${(e as Error).message}`);
		}
		this.logger.logOk("ADC Error App iniciada");
	}
}
