import { AppWithSeo } from "../../AppWithSeo.js";

/**
 * ADC Identity App - Panel de gestión de identidades
 * Administración de usuarios, roles, grupos, organizaciones y regiones
 */
export default class AdcIdentityApp extends AppWithSeo {
	async run(): Promise<void> {
		this.registerSeo({
			sitemap: { paths: [{ path: "/", changefreq: "monthly", priority: 0.6 }] },
			pageMeta: {
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
			},
		});
		this.logger.logOk("ADC Identity App iniciada");
	}
}
