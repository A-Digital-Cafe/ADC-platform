import type { UIModuleConfig } from "../../../../interfaces/modules/IUIModule.js";
import type { HostOptions } from "../../../../interfaces/modules/providers/IHttpServer.js";

/**
 * Producción real: NODE_ENV=production y NO el modo local de pruebas.
 * `start:prodtests` usa PROD_PORT=3000, por lo que se trata como entorno local.
 */
function isRealProduction(): boolean {
	return process.env.NODE_ENV === "production" && process.env.PROD_PORT !== "3000";
}

export function getUIModuleHostOptions(config: UIModuleConfig): HostOptions {
	const security = config.security;
	const envOverrides = isRealProduction() ? security?.production?.headers : security?.development?.headers;
	const headers = { ...(security?.headers ?? {}), ...(envOverrides ?? {}) };
	return Object.keys(headers).length > 0 ? { spaFallback: true, headers } : { spaFallback: true };
}
