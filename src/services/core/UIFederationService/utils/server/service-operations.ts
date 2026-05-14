import type { RegisteredUIModule } from "../../types.js";
import type { UIFederationContext } from "../types/context.js";
import { injectImportMapsInModuleHTMLs, updateImportMap } from "./import-map-updater.js";

export interface UIStats {
	registeredModules: number;
	importMapEntries: number;
	modules: RegisteredUIModule[];
	namespaces: string[];
}

/** Desregistra un módulo UI del namespace correspondiente. */
export async function unregisterUIModule(name: string, ctx: UIFederationContext, namespace?: string): Promise<void> {
	ctx.logger.logInfo(`Desregistrando módulo UI: ${name}`);

	let found: { namespace: string; module: import("../../types.js").RegisteredUIModule } | null = null;
	if (namespace) {
		const module = ctx.registry.getModule(namespace, name);
		if (module) found = { namespace, module };
	} else {
		found = ctx.registry.findModuleByName(name);
	}

	if (!found) {
		ctx.logger.logWarn(`Módulo UI ${name} no encontrado`);
		return;
	}

	ctx.registry.getNamespaceModules(found.namespace).delete(name);
	updateImportMap(found.namespace, ctx);
	ctx.logger.logOk(`Módulo UI ${name} [${found.namespace}] desregistrado`);
}

/** Reinyecta los import maps en todos los módulos construidos. */
export async function refreshAllImportMaps(ctx: UIFederationContext): Promise<void> {
	ctx.logger.logInfo("Reinyectando import maps en todos los módulos...");
	for (const namespace of ctx.registry.namespaces) {
		for (const [name, module] of ctx.registry.getNamespaceModules(namespace)) {
			if (module.buildStatus === "built" && module.outputPath) {
				await injectImportMapsInModuleHTMLs(name, namespace, ctx);
			}
		}
		updateImportMap(namespace, ctx);
	}
	ctx.logger.logOk("Import maps actualizados en todos los módulos");
}

/** Devuelve estadísticas agregadas del servicio. */
export function computeStats(ctx: UIFederationContext): UIStats {
	const modules = ctx.registry.allModules;
	let importMapEntries = 0;
	for (const importMap of ctx.importMaps.values()) {
		importMapEntries += Object.keys(importMap.imports).length;
	}
	return { registeredModules: modules.length, importMapEntries, modules, namespaces: ctx.registry.namespaces };
}
