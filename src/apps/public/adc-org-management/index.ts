import { AppWithSeo } from "../../AppWithSeo.js";

/**
 * ADC Organization Management App - Gestión de organizaciones
 */
export default class AdcOrgManagementApp extends AppWithSeo {
	async run(): Promise<void> {
		this.registerSeo({
			sitemap: { paths: [{ path: "/", changefreq: "monthly", priority: 0.6 }] },
			pageMeta: {
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
			},
		});
		this.logger.logOk("ADC Organization Management App started");
	}
}
