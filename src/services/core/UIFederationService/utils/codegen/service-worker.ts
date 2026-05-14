import type { RegisteredUIModule } from "../../types.js";
import { collectI18nNamespaces, createCacheRevision } from "./sw-context.js";
import { buildSwHeader, buildSwLifecycle } from "./sw-header.js";
import { SW_CACHE_STRATEGIES, buildSwFetchHandler } from "./sw-fetch.js";
import { buildSwMessageHandler } from "./sw-message.js";

/**
 * Genera el contenido del service worker para una app
 */
export function generateServiceWorker(module: RegisteredUIModule, namespaceModules: Map<string, RegisteredUIModule>, _port: number): string {
	const ctx = {
		namespace: module.namespace,
		moduleName: module.name,
		cacheRevision: createCacheRevision(module, namespaceModules),
		isDevelopment: process.env.NODE_ENV !== "production",
		i18nNamespaces: collectI18nNamespaces(namespaceModules),
	};

	return [
		buildSwHeader(ctx),
		buildSwLifecycle(ctx.namespace),
		buildSwFetchHandler(ctx.namespace),
		SW_CACHE_STRATEGIES,
		buildSwMessageHandler(ctx.namespace),
	].join("");
}
