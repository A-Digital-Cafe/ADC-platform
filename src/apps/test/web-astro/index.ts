import { BaseApp } from "../../BaseApp.js";

/**
 * Banco de pruebas de la estrategia `astro` (SSG por CLI) de UIFederationService.
 *
 * Existe para que la estrategia tenga un consumidor real: es la única que shellea
 * a un binario externo (`astro build`), así que un bump de astro no se detecta con
 * typecheck — hay que compilarla.
 */
export default class WebAstroApp extends BaseApp {
	async run() {
		this.logger.logOk(`${this.name} ejecutándose (estrategia astro)`);
	}
}
