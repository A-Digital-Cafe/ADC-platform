import { BaseApp } from "../../BaseApp.js";

/**
 * Help - Centro de ayuda, políticas y compromisos públicos de ADC.
 */
export default class HelpApp extends BaseApp {
	async run() {
		this.logger.logOk(`${this.name} ejecutándose`);
	}
}
