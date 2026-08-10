import { BaseApp } from "../../BaseApp.js";

/**
 * Panel de administración general de la plataforma (brechas de datos, auditoría, planes y
 * moderación de Drive). El gating real es del backend; la app sólo decide qué tabs pinta.
 */
export default class AdcAdminPanelApp extends BaseApp {
	async run(): Promise<void> {
		this.logger.logOk("ADC Admin Panel App iniciada");
	}
}
