import type { UIModuleConfig } from "../../../../interfaces/modules/IUIModule.js";
import type { HostOptions } from "../../../../interfaces/modules/providers/IHttpServer.js";
import { isRealProduction } from "@common/utils/runtime-env.ts";

export function getUIModuleHostOptions(config: UIModuleConfig): HostOptions {
	const security = config.security;
	const envOverrides = isRealProduction() ? security?.production?.headers : security?.development?.headers;
	const headers = { ...security?.headers, ...envOverrides };
	return Object.keys(headers).length > 0 ? { spaFallback: true, headers } : { spaFallback: true };
}
