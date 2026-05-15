import { BaseApp } from "../../BaseApp.js";

/**
 * ADC Organization Management App - Gestión de organizaciones
 */
export default class AdcOrgManagementApp extends BaseApp {
	async run(): Promise<void> {
		this.logger.logOk("ADC Organization Management App started");
	}
}
