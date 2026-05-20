import { BaseApp } from "../../BaseApp.js";

/**
 * Status App - System and service status dashboard
 */
export default class StatusApp extends BaseApp {
	async run() {
		this.logger.logOk(`${this.name} ejecutándose`);
	}
}
