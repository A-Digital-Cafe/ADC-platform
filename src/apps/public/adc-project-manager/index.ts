import { AppWithSeo } from "../../AppWithSeo.js";

/**
 * ADC Project Manager App - Panel de gestión de proyectos tipo Jira
 */
export default class AdcProjectManagerApp extends AppWithSeo {
	async run(): Promise<void> {
		this.registerSeo({
			sitemap: { paths: [{ path: "/", changefreq: "monthly", priority: 0.6 }] },
			pageMeta: {
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
			},
		});
		this.logger.logOk("ADC Project Manager App iniciada");
	}
}
