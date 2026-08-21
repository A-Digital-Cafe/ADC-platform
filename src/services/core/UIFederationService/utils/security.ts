import type { UIModuleConfig } from "../../../../interfaces/modules/IUIModule.js";
import type { HostOptions, StaticAccessGuard } from "../../../../interfaces/modules/providers/IHttpServer.js";
import { isRealProduction } from "@common/utils/runtime-env.ts";

export function getUIModuleHostOptions(
	config: UIModuleConfig,
	accessGuard?: StaticAccessGuard,
	pathGuards?: HostOptions["pathGuards"]
): HostOptions {
	const security = config.security;
	const envOverrides = isRealProduction() ? security?.production?.headers : security?.development?.headers;
	const headers: Record<string, string> = { ...security?.headers, ...envOverrides };

	// Una app que no pidió SEO no va al índice de los buscadores. Es el mismo criterio que el
	// `robots.txt` que registra `serve-module`, pero con el mecanismo que de verdad DESINDEXA:
	// `Disallow` sólo evita el rastreo, y una URL enlazada desde afuera puede aparecer igual en los
	// resultados. Derivado de `enableSEO` y no declarado app por app, para que no pueda quedar
	// desincronizado ni haga falta acordarse: una app nueva nace fuera del índice y entra sólo
	// cuando alguien lo pide explícitamente. Una app que declare su propio `X-Robots-Tag` manda.
	if (!config.enableSEO) headers["X-Robots-Tag"] ??= "noindex, nofollow";

	const base: HostOptions = { spaFallback: true };
	if (config.spaRoutes?.length) base.spaRoutes = config.spaRoutes;
	if (Object.keys(headers).length > 0) base.headers = headers;
	if (accessGuard) base.accessGuard = accessGuard;
	if (pathGuards?.length) base.pathGuards = pathGuards;
	return base;
}
