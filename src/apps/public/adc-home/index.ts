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
		});
		this.logger.logOk(`${this.name} ejecutándose`);
	}
}
