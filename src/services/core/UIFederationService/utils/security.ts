import type { UIModuleConfig } from "../../../../interfaces/modules/IUIModule.js";
import type { HostOptions } from "../../../../interfaces/modules/providers/IHttpServer.js";

export function getUIModuleHostOptions(config: UIModuleConfig): HostOptions {
	const headers = config.security?.headers;
	return headers && Object.keys(headers).length > 0 ? { spaFallback: true, headers } : { spaFallback: true };
}
