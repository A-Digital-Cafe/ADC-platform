import { generateI18nClientCode } from "../codegen/i18n-client.js";
import { generateServiceWorker } from "../codegen/service-worker.js";
import type { UIFederationContext } from "../types/context.js";

function resolvePath(devPort: number | undefined, namespace: string, filename: string): string {
	return devPort ? `/${filename}` : `/${namespace}/${filename}`;
}

/** Registra el endpoint que sirve el cliente i18n para un namespace (solo si hay host). */
export async function registerI18nClientEndpoint(namespace: string, ctx: UIFederationContext): Promise<void> {
	if (!ctx.httpProvider) return;

	const namespaceModules = ctx.registry.getNamespaceModules(namespace);
	const layoutModule = ctx.registry.getHostModule(namespace);
	if (!layoutModule) return;

	try {
		const content = generateI18nClientCode(layoutModule, namespaceModules, ctx.port);
		const i18nPath = resolvePath(layoutModule.uiConfig.devPort, namespace, "adc-i18n.js");

		ctx.httpProvider.registerRoute("GET", i18nPath, (_req: any, reply: any) => {
			reply.header("Content-Type", "application/javascript");
			reply.send(content);
		});
		ctx.logger.logDebug(`i18n Client [${namespace}] registrado en ${i18nPath}`);
	} catch (error: any) {
		ctx.logger.logDebug(`Endpoint i18n ya registrado para ${namespace}: ${error.message}`);
	}
}

/** Registra el endpoint del Service Worker para un namespace (solo si hay host). */
export async function registerServiceWorkerEndpoint(namespace: string, ctx: UIFederationContext): Promise<void> {
	if (!ctx.httpProvider) return;

	const namespaceModules = ctx.registry.getNamespaceModules(namespace);
	const layoutModule = ctx.registry.getHostModule(namespace);
	if (!layoutModule) return;

	try {
		const swContent = generateServiceWorker(layoutModule, namespaceModules, ctx.port);
		const swPath = resolvePath(layoutModule.uiConfig.devPort, namespace, "adc-sw.js");

		ctx.httpProvider.registerRoute("GET", swPath, (_req: any, reply: any) => {
			reply.header("Content-Type", "application/javascript");
			reply.header("Service-Worker-Allowed", "/");
			reply.header("Cache-Control", "no-store, max-age=0");
			reply.send(swContent);
		});
		ctx.logger.logDebug(`Service Worker [${namespace}] registrado en ${swPath}`);
	} catch (error: any) {
		ctx.logger.logDebug(`Endpoint SW ya registrado para ${namespace}: ${error.message}`);
	}
}
