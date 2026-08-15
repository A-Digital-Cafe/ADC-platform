import { AppWithSeo } from "../../AppWithSeo.js";
import { buildPageGraph } from "./seo-jsonld.js";

/**
 * ADC Home - Landing page para presentar los microfronts de Abby's Digital Cafe
 */
export default class AdcHomeApp extends AppWithSeo {
	async run() {
		this.registerSeo({
			sitemap: { isIndex: true, paths: [{ path: "/", changefreq: "weekly", priority: 1 }] },
			pageMeta: {
				defaults: {
					og: { siteName: "Abby's Digital Cafe", locale: "es_ES", type: "website" },
					twitter: { card: "summary_large_image" },
					ogBrand: { background: "#fdefe0", color: "#7b1a00", brandName: "Abby's Digital Cafe" },
				},
				pages: [
					{
						path: "/",
						meta: {
							title: "Abby's Digital Cafe",
							titleTemplate: "%s",
							description:
								"Plataforma modular open-source para construir y orquestar productos digitales con arquitectura de microfrontends.",
							jsonLd: buildPageGraph(
								"/",
								"Abby's Digital Cafe",
								"Plataforma modular open-source para construir y orquestar productos digitales con arquitectura de microfrontends."
							),
						},
					},
				],
			},
			// El apex es la puerta de entrada, así que su `llms.txt` es un índice de las apps: un
			// crawler de IA que llega acá tiene que poder saltar a cada subdominio sin adivinarlos.
			llms: {
				title: "Abby's Digital Cafe",
				description: "Plataforma modular open-source: cada app vive en su propio subdominio y comparte identidad, permisos y almacenamiento.",
				sections: ({ origin }) => {
					const base = new URL(origin).host.replace(/^www\./, "");
					const app = (sub: string) => `https://${sub}.${base}`;
					return [
						{
							title: "Apps de la plataforma",
							links: [
								{ title: "Community", description: "Artículos, rutas de aprendizaje y contenido de la comunidad.", href: app("community") },
								{ title: "Drive", description: "Almacenamiento de archivos, carpetas compartidas y túnel de dispositivos.", href: app("drive") },
								{ title: "Projects", description: "Gestión de proyectos y tareas.", href: app("projects") },
								{ title: "Editor de imágenes", description: "Editor de imágenes, memes y stickers.", href: app("editor") },
								{ title: "Status", description: "Estado de los servicios y tickets de soporte.", href: app("status") },
								{ title: "Help", description: "Documentación de uso y documentos legales.", href: app("help") },
							],
						},
					];
				},
			},
		});
		this.logger.logOk(`${this.name} ejecutándose`);
	}
}
