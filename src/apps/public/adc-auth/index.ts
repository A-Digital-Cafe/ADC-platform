import { AppWithSeo } from "../../AppWithSeo.js";

/**
 * ADC Auth App - Sistema de autenticación
 * Host app para login/register via SessionManagerService
 */
export default class AdcAuthApp extends AppWithSeo {
	async run(): Promise<void> {
		this.registerSeo({
			sitemap: {
				paths: [
					{ path: "/login", changefreq: "monthly", priority: 0.7 },
					{ path: "/register", changefreq: "monthly", priority: 0.7 },
				],
			},
			pageMeta: {
				defaults: {
					titleTemplate: "%s · Abby's Digital Cafe",
					og: { siteName: "Abby's Digital Cafe", locale: "es_ES", type: "website" },
					twitter: { card: "summary" },
					ogBrand: { background: "#ffede3", color: "#712b00", brandName: "Abby's Digital Cafe" },
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
					// Páginas de canje de tokens por email: fuera del sitemap y noindex a propósito.
					// El `robots` va por página y no en los defaults porque /login y /register sí se
					// indexan: son las que responden la búsqueda "iniciar sesión <marca>".
					{
						path: "/cancel-deletion",
						meta: {
							title: "Cancelar baja de cuenta",
							description: "Cancela la baja programada de tu cuenta con el enlace del correo.",
							robots: "noindex,nofollow",
						},
					},
					{
						path: "/confirm-email",
						meta: {
							title: "Confirmar cambio de email",
							description: "Confirma el nuevo email de tu cuenta con el enlace del correo.",
							robots: "noindex,nofollow",
						},
					},
				],
			},
		});
		this.logger.logOk("ADC Auth App iniciada");
	}
}
