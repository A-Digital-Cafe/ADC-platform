import * as path from "node:path";
import type { RegisteredUIModule } from "../../types.js";
import type { IBuildContext } from "../../strategies/types.js";
import { getStrategy } from "../../strategies/index.js";
import type { UIFederationContext } from "../types/context.js";
import { copyPublicFiles } from "../fs/file-operations.js";
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

	// Modo "sólo kernel" (`ADC_NO_UI_SERVERS=true`, usado por `driver.mjs boot-check`): el módulo UI
	// se registra pero no se compila ni levanta servidor, ahorrando ~27 hijos de bundler.
	// El gate va acá y no en `shouldStartDevServer` porque devolver false cae a `buildStatic`, que
	// igual spawnea watchers. Cortar acá cubre los tres frameworks sin alterar producción.
	if (process.env.ADC_NO_UI_SERVERS === "true") {
		module.buildStatus = "built";
		ctx.logger.logWarn(`Build de ${module.name} [${namespace}] omitido: ADC_NO_UI_SERVERS=true (modo sólo kernel).`);
		return;
	}

	if (framework !== "stencil") {
		await waitForUILibraryBuild(module, namespaceModules, ctx.logger);
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
			// En prod los assets de public/ (favicon, tutorials/, etc.) deben quedar en el
			// output servido por host; en dev los sirve el devServer directamente.
			if (framework !== "stencil" && module.outputPath) {
				await copyPublicFiles(module.appDir, module.outputPath, ctx.logger);
			}
			ctx.logger.logOk(`Build completado para ${module.name} [${namespace}]`);
		}
	} catch (error: any) {
		module.buildStatus = "error";
		ctx.logger.logError(`Error en build de ${module.name}: ${error.message}`);
		throw error;
	}
}
