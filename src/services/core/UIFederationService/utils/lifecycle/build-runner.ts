import * as path from "node:path";
import type { RegisteredUIModule } from "../../types.js";
import type { IBuildContext } from "../../strategies/types.js";
import { getStrategy } from "../../strategies/index.js";
import type { UIFederationContext } from "../types/context.js";
import { waitForDeclaredRemotes, waitForUILibraryBuild } from "./wait-helpers.js";

function applyBuildResult(module: RegisteredUIModule, namespace: string, result: any, ctx: UIFederationContext): void {
	if (result.watcher) {
		ctx.watchBuilds.set(`${namespace}:${module.name}`, result.watcher);
		module.watcher = result.watcher;
	}
	if (result.outputPath) module.outputPath = result.outputPath;
}

/**
 * Ejecuta el build de un módulo UI usando la estrategia correspondiente.
 * Antes del build, espera a que las dependencias (UI library / remotes) estén listas.
 */
export async function buildUIModule(module: RegisteredUIModule, namespace: string, ctx: UIFederationContext): Promise<void> {
	const framework = module.uiConfig.framework || "astro";
	const strategy = getStrategy(framework);
	const namespaceModules = ctx.registry.getNamespaceModules(namespace);
	const namespaceOutputDir = path.join(ctx.uiOutputBaseDir, namespace);

	if (framework !== "stencil") {
		await waitForUILibraryBuild(namespaceModules, module.name, ctx.logger);
	}
	if (module.uiConfig.isHost ?? false) {
		await waitForDeclaredRemotes(module, namespaceModules, ctx.logger);
	}

	module.buildStatus = "building";
	ctx.logger.logInfo(`Build: ${module.name} [${namespace}] usando ${strategy.name}`);

	try {
		const buildCtx: IBuildContext = {
			module,
			namespace,
			registeredModules: namespaceModules,
			uiOutputBaseDir: namespaceOutputDir,
			logger: ctx.logger,
			isDevelopment: process.env.NODE_ENV === "development",
		};

		const result = await strategy.build(buildCtx);
		applyBuildResult(module, namespace, result, ctx);
		module.buildStatus = "built";

		if (!buildCtx.isDevelopment) {
			ctx.logger.logOk(`Build completado para ${module.name} [${namespace}]`);
		}
	} catch (error: any) {
		module.buildStatus = "error";
		ctx.logger.logError(`Error en build de ${module.name}: ${error.message}`);
		throw error;
	}
}
