import { BaseApp } from "../../BaseApp";
/**
 * ADC Error App - Páginas de error de la plataforma
 *
 * Backend (SessionManager/OAuth/Moderation) redirige acá con un path
 * que identifica el tipo de error y query params con el detalle.
 */
export default class AdcErrorApp extends BaseApp {
	async run(): Promise<void> {
		this.logger.logOk("ADC Error App iniciada");
	}
}
