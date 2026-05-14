import type { UIFederationContext } from "../types/context.js";
import { createImportMapObject, generateCompleteImportMap } from "../bundler/import-map.js";
import { injectImportMapsInHTMLs } from "../codegen/html-templates.js";

/** Recalcula y guarda el import map de un namespace. */
export function updateImportMap(namespace: string, ctx: UIFederationContext): void {
	const modules = ctx.registry.getNamespaceModules(namespace);
	const imports = generateCompleteImportMap(modules, ctx.port, namespace);
	ctx.importMaps.set(namespace, createImportMapObject(imports));
	ctx.logger.logDebug(`Import map [${namespace}] actualizado con ${Object.keys(imports).length} entradas`);
}

/** Inyecta el import map del namespace en los HTMLs de un módulo concreto. */
export async function injectImportMapsInModuleHTMLs(moduleName: string, namespace: string, ctx: UIFederationContext): Promise<void> {
	const module = ctx.registry.getModule(namespace, moduleName);
	if (!module?.outputPath) return;

	const modules = ctx.registry.getNamespaceModules(namespace);
	const importMap = generateCompleteImportMap(modules, ctx.port, namespace);
	await injectImportMapsInHTMLs(module.outputPath, importMap, ctx.logger);
	ctx.logger.logDebug(`Import maps inyectados en HTMLs de ${moduleName} [${namespace}]`);
}
