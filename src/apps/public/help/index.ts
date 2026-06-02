import { AppWithSeo } from "../../AppWithSeo.js";

const HELP_PATHS = [
	"/",
	"/privacy",
	"/cookies",
	"/terms",
	"/values",
	"/ethics",
	"/hria",
	"/authority-requests",
	"/transparency",
	"/contact",
	"/team",
	"/roadmap",
];

const HELP_PAGE_META: Record<string, { title: string; description: string }> = {
	"/": { title: "Ayuda", description: "Centro de ayuda, políticas y compromisos públicos de Abby's Digital Cafe." },
	"/privacy": { title: "Política de privacidad", description: "Cómo recopilamos, usamos y protegemos tus datos personales en ADC." },
	"/cookies": { title: "Política de cookies", description: "Qué cookies usamos y cómo gestionarlas en Abby's Digital Cafe." },
	"/terms": { title: "Términos de servicio", description: "Condiciones de uso de la plataforma Abby's Digital Cafe." },
	"/values": { title: "Nuestros valores", description: "Principios que guían el diseño y operación de ADC." },
	"/ethics": { title: "Ética y compromisos", description: "Compromisos éticos públicos de Abby's Digital Cafe." },
	"/hria": { title: "Evaluación de impacto en derechos humanos", description: "Resultados públicos de nuestra evaluación HRIA." },
	"/authority-requests": { title: "Solicitudes de autoridades", description: "Cómo gestionamos las solicitudes de autoridades públicas." },
	"/transparency": { title: "Transparencia", description: "Informes y métricas de transparencia de Abby's Digital Cafe." },
	"/contact": { title: "Contacto", description: "Canales públicos para contactar con el equipo de ADC." },
	"/team": { title: "Equipo", description: "Personas detrás de Abby's Digital Cafe." },
	"/roadmap": { title: "Hoja de ruta", description: "Próximos hitos y prioridades del proyecto." },
};

/**
 * Help - Centro de ayuda, políticas y compromisos públicos de ADC.
 */
export default class HelpApp extends AppWithSeo {
	async run() {
		this.registerSeo({
			sitemap: {
				paths: HELP_PATHS.map((p) => ({ path: p, changefreq: "monthly" as const, priority: p === "/" ? 0.8 : 0.5 })),
			},
			pageMeta: {
				defaults: {
					titleTemplate: "%s · ADC Ayuda",
					og: { siteName: "Abby's Digital Cafe", locale: "es_ES", type: "website" },
					twitter: { card: "summary" },
					ogBrand: { background: "#edf5e3", color: "#772300", brandName: "ADC Ayuda" },
				},
				pages: HELP_PATHS.map((p) => ({ path: p, meta: HELP_PAGE_META[p] })),
			},
		});
		this.logger.logOk(`${this.name} ejecutándose`);
	}
}
