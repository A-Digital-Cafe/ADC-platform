import type { RegisteredUIModule } from "../../types.js";
import type { UIFederationContext } from "../types/context.js";
import { generateStandaloneFiles } from "../codegen/standalone-files.js";
import { registerPublicAssets } from "../fs/public-assets.js";
import { buildUIModule } from "./build-runner.js";
import { regenerateLayoutConfigsForNamespace } from "./regenerate-layouts.js";
import { injectImportMapsInModuleHTMLs, updateImportMap } from "../server/import-map-updater.js";
import { serveModule } from "../server/serve-module.js";
import { registerI18nClientEndpoint, registerServiceWorkerEndpoint } from "../server/i18n-sw-endpoints.js";

async function registerPublicAssetsIfAble(module: RegisteredUIModule, ctx: UIFederationContext): Promise<void> {
	const { httpProvider } = ctx;
	if (!httpProvider) return;
	const namespaceModules = ctx.registry.getNamespaceModules(module.namespace);
	await registerPublicAssets({
		module,
		namespaceModules,
		logger: ctx.logger,
		serveStatic: (urlPath, dir) => httpProvider.serveStatic(urlPath, dir),
	});
}

async function registerI18nNamespace(module: RegisteredUIModule, ctx: UIFederationContext): Promise<void> {
	if (!module.uiConfig.i18n || !ctx.langManager) return;
	const namespaceModules = ctx.registry.getNamespaceModules(module.namespace);

	const i18nDependencies = module.uiConfig.uiDependencies?.filter((dep) => {
		const depModule = namespaceModules.get(dep);
		return depModule?.uiConfig.i18n;
	});
	await ctx.langManager.registerNamespace(module.name, module.appDir, i18nDependencies);
}

async function registerEndpointsIfHost(module: RegisteredUIModule, ctx: UIFederationContext): Promise<void> {
	const isHost = module.uiConfig.isHost ?? false;
	if (!isHost) return;

	if (module.uiConfig.i18n) await registerI18nClientEndpoint(module.namespace, ctx);
	if (module.uiConfig.serviceWorker) await registerServiceWorkerEndpoint(module.namespace, ctx);
}

/**
 * Orquesta el flujo completo de registro de un módulo UI tras su validación inicial.
 * Levanta `module.buildStatus = "error"` y propaga la excepción si algo falla.
 */
export async function runRegisterFlow(module: RegisteredUIModule, ctx: UIFederationContext): Promise<void> {
	const isHost = module.uiConfig.isHost ?? false;
	const namespace = module.namespace;

	try {
		if (isHost) await generateStandaloneFiles(module.appDir, module.uiConfig, ctx.logger);

		await buildUIModule(module, namespace, ctx);

		if (module.outputPath) await injectImportMapsInModuleHTMLs(module.name, namespace, ctx);
		updateImportMap(namespace, ctx);

		await serveModule(module, namespace, ctx);
		await registerPublicAssetsIfAble(module, ctx);
		await registerI18nNamespace(module, ctx);
		await registerEndpointsIfHost(module, ctx);

		if (!isHost && module.uiConfig.devPort) {
			await regenerateLayoutConfigsForNamespace(namespace, ctx);
		}
	} catch (error: any) {
		module.buildStatus = "error";
		ctx.logger.logError(`Error registrando módulo UI ${module.name}: ${error.message}`);
		throw error;
	}
}
