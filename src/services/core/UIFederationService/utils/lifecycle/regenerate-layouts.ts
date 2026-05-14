import * as path from "node:path";
import type { RegisteredUIModule } from "../../types.js";
import { getStrategy } from "../../strategies/index.js";
import type { UIFederationContext } from "../types/context.js";
import { stopWatcherIfRunning } from "./watcher-control.js";

function shouldRegenerate(module: RegisteredUIModule): boolean {
	const isHost = module.uiConfig.isHost ?? false;
	return isHost && module.buildStatus === "built" && !!module.uiConfig.devPort && process.env.NODE_ENV === "development";
}

async function restartDevServer(moduleName: string, module: RegisteredUIModule, namespace: string, ctx: UIFederationContext): Promise<any> {
	const strategy = getStrategy(module.uiConfig.framework || "react");
	const namespaceModules = ctx.registry.getNamespaceModules(namespace);
	const namespaceOutputDir = path.join(ctx.uiOutputBaseDir, namespace);

	ctx.logger.logDebug(`Reiniciando dev server de ${moduleName}...`);
	return strategy.startDevServer({
		module,
		namespace,
		registeredModules: namespaceModules,
		uiOutputBaseDir: namespaceOutputDir,
		isDevelopment: true,
		logger: ctx.logger,
	});
}

function updateWatcher(moduleName: string, module: RegisteredUIModule, namespace: string, result: any, ctx: UIFederationContext): void {
	if (!result?.watcher) return;
	module.watcher = result.watcher;
	ctx.watchBuilds.set(`${namespace}:${moduleName}`, result.watcher);
}

async function regenerateOneLayout(moduleName: string, module: RegisteredUIModule, namespace: string, ctx: UIFederationContext): Promise<void> {
	ctx.logger.logInfo(`Regenerando config de ${moduleName} por nuevo remote en ${namespace}`);
	try {
		await stopWatcherIfRunning(module.watcher, moduleName, ctx.logger);
		const result = await restartDevServer(moduleName, module, namespace, ctx);
		updateWatcher(moduleName, module, namespace, result, ctx);
		ctx.logger.logOk(`Dev server reiniciado para ${moduleName} con nuevos remotes`);
	} catch (error: any) {
		ctx.logger.logWarn(`Error regenerando config de ${moduleName}: ${error.message}`);
	}
}

/**
 * Regenera configuraciones de layouts cuando se registra un nuevo remote.
 * Solo afecta hosts ya construidos con devPort en modo desarrollo.
 */
export async function regenerateLayoutConfigsForNamespace(namespace: string, ctx: UIFederationContext): Promise<void> {
	const modules = ctx.registry.getNamespaceModules(namespace);
	for (const [moduleName, module] of modules.entries()) {
		if (shouldRegenerate(module)) {
			await regenerateOneLayout(moduleName, module, namespace, ctx);
		}
	}
}
