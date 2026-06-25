import { BaseApp } from "../../BaseApp.js";
import type { IHttpServerProvider } from "../../../interfaces/modules/providers/IHttpServer.js";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";

/**
 * App Home - Página principal del dashboard
 */
export default class WebHomeApp extends BaseApp {
	async run() {
		this.logger.logOk(`${this.name} ejecutándose`);

		await this.#registerAPIEndpoints();
	}

	async #registerAPIEndpoints() {
		try {
			// Usar el tipo del provider (http-server-provider) para obtener el correcto según el entorno
			const httpProvider = this.getMyProvider<IHttpServerProvider>("fastify-server");

			httpProvider.registerRoute("GET", "/api/dashboard/stats", async (_req: any, res: any) => {
				try {
					const identityService = this.getMyService<IIdentityManagerService>("IdentityManagerService");
					const stats = await identityService.getStats();

					res.json({
						success: true,
						data: {
							totalUsers: stats.totalUsers,
							totalGroups: stats.totalGroups,
							totalRoles: stats.totalRoles,
						},
					});
				} catch (error: any) {
					res.status(500).json({
						success: false,
						error: error.message,
					});
				}
			});

			this.logger.logDebug("API endpoints registrados");
		} catch (error: any) {
			this.logger.logWarn(`No se pudieron registrar API endpoints: ${error.message}`);
		}
	}
}
