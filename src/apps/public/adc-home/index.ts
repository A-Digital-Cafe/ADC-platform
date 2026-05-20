import { BaseApp } from "../../BaseApp.js";

/**
 * ADC Home - Landing page para presentar los microfronts de Abby's Digital Cafe
 */
export default class AdhHomeApp extends BaseApp {
	async run() {
		this.logger.logOk(`${this.name} ejecutándose`);
	}
}
