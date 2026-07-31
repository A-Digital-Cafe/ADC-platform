import { generateI18nClientCode } from "../codegen/i18n-client.js";
import { generateServiceWorker } from "../codegen/service-worker.js";
import type { UIFederationContext } from "../types/context.js";
import { i18nAssetPath } from "../i18n-paths.js";


/** Registra el endpoint que sirve el cliente i18n para un namespace (solo si hay host). */
export async function registerI18nClientEndpoint(namespace: string, ctx: UIFederationContext): Promise<void> {
	if (!ctx.httpProvider) return;
	if (!ctx.registry.getHostModule(namespace)) return;

	const i18nPath = i18nAssetPath(namespace, "adc-i18n.js");

	// Generación perezosa (en cada request, no al registrar): los presets cargan después de las
	// apps de src, y un snapshot los dejaría fuera de la lista de namespaces.
	ctx.httpProvider.registerRoute("GET", i18nPath, (_req: any, reply: any) => {
		const layoutModule = ctx.registry.getHostModule(namespace);
		if (!layoutModule) {
			reply.status(503).send("// host del namespace no disponible");
			return;
		}
		const content = generateI18nClientCode(layoutModule, ctx.registry.getNamespaceModules(namespace), ctx.port);
		reply.header("Content-Type", "application/javascript");
		reply.send(content);
	});
	ctx.logger.logDebug(`i18n Client [${namespace}] registrado en ${i18nPath}`);
}

/** Registra el endpoint del Service Worker para un namespace (solo si hay host). */
export async function registerServiceWorkerEndpoint(namespace: string, ctx: UIFederationContext): Promise<void> {
	if (!ctx.httpProvider) return;
	if (!ctx.registry.getHostModule(namespace)) return;

	const swPath = i18nAssetPath(namespace, "adc-sw.js");

	// Perezosa igual que el cliente i18n, para precachear también los presets tardíos.
	ctx.httpProvider.registerRoute("GET", swPath, (_req: any, reply: any) => {
		const layoutModule = ctx.registry.getHostModule(namespace);
		if (!layoutModule) {
			reply.status(503).send("// host del namespace no disponible");
			return;
		}
		const swContent = generateServiceWorker(layoutModule, ctx.registry.getNamespaceModules(namespace), ctx.port);
		reply.header("Content-Type", "application/javascript");
		reply.header("Service-Worker-Allowed", "/");
		reply.header("Cache-Control", "no-store, max-age=0");
		reply.send(swContent);
	});
	ctx.logger.logDebug(`Service Worker [${namespace}] registrado en ${swPath}`);
}
