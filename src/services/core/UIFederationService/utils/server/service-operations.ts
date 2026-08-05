import type { RegisteredUIModule } from "../../types.js";
import type { UIFederationContext } from "../types/context.js";
import { stopWatcher } from "../lifecycle/watcher-control.js";
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

	await reapWatcher(name, found.namespace, found.module, ctx);

	ctx.registry.getNamespaceModules(found.namespace).delete(name);
	await releaseI18nNamespace(found.module, ctx);
	updateImportMap(found.namespace, ctx);
	ctx.logger.logOk(`Módulo UI ${name} [${found.namespace}] desregistrado`);
}

/** Devuelve al `LangManagerService` el namespace de i18n que `register-flow.ts` le dio para apps deshabilitadas */
async function releaseI18nNamespace(module: RegisteredUIModule, ctx: UIFederationContext): Promise<void> {
	if (!module.uiConfig.i18n || !ctx.langManager) return;
	try {
		await ctx.langManager.unregisterNamespace(module.name);
	} catch (error: any) {
		ctx.logger.logWarn(`Error liberando el namespace i18n de ${module.name}: ${error.message}`);
	}
}

/**
 * Mata el dev server del módulo y borra su entrada de `ctx.watchBuilds`.
 *
 * Sin esto, cada disable/reload de una app UI dejaba un rspack residente para siempre:
 * `stopAllWatchers` sólo corre en el `stop()` del servicio, y al borrar el módulo del
 * registry se perdía la única referencia al hijo. La clave del mapa es la misma que usa
 * `build-runner.ts` al guardarlo (`namespace:name`, con el `name` que es la clave del
 * `Map` del namespace).
 */
async function reapWatcher(name: string, namespace: string, module: RegisteredUIModule, ctx: UIFederationContext): Promise<void> {
	const watchKey = `${namespace}:${name}`;
	const watcher = module.watcher ?? ctx.watchBuilds.get(watchKey);
	ctx.watchBuilds.delete(watchKey);
	if (!watcher) return;

	try {
		await stopWatcher(watchKey, watcher, ctx.logger);
	} catch (error: any) {
		ctx.logger.logWarn(`Error deteniendo dev server de ${name} [${namespace}]: ${error.message}`);
	}
	module.watcher = undefined;
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
