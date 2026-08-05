import { BaseApp } from "../../BaseApp.js";

/**
 * Banco de pruebas de la estrategia `vite-react` (bundler vite, no rspack).
 *
 * Existe para que las estrategias `vite-*` de UIFederationService tengan un
 * consumidor real: sin una app que las use, un bump de vite sólo se valida
 * a mano. No aporta lógica de negocio.
 */
export default class WebViteReactApp extends BaseApp {
	async run() {
		this.logger.logOk(`${this.name} ejecutándose (estrategia vite-react)`);
	}
}
