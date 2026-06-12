import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseFrameworkStrategy } from "../base-strategy.js";
import type { BundlerType, IBuildContext, IBuildResult } from "../types.js";
import { getConfigDir } from "../../utils/fs/path-resolver.js";
import aliasGenerator from "../../utils/bundler/alias-generator.js";
import { generateTailwindConfig, generatePostCSSConfig, hasTailwindEnabled } from "../../config-generators/tailwind.js";
import { buildRspackConfigContent } from "../shared/rspack-config-template.js";
import { runRspackBuild, runRspackWatcher } from "../shared/rspack-process.js";

/**
 * Clase base para estrategias Rspack. Orquesta:
 *  - Generación de `rspack.config.mjs` (delega en `shared/rspack-config-template`)
 *  - Lanzado de dev server (`rspack serve`)
 *  - Build estático y build con watch (`rspack build [--watch]`)
 *
 * Las subclases sólo deben proveer los hooks específicos del framework.
 */
export abstract class RspackBaseStrategy extends BaseFrameworkStrategy {
	readonly bundler: BundlerType = "rspack";

	async generateConfig(context: IBuildContext): Promise<string> {
		const { module, registeredModules } = context;
		const configDir = getConfigDir(context.namespace, module.uiConfig.name);
		await fs.mkdir(configDir, { recursive: true });

		const isLayout = this.isLayout(context);
		const isHost = this.isHost(context);
		const isProduction = process.env.NODE_ENV === "production";
		const safeName = this.getSafeName(module.uiConfig.name);
		const usedFrameworks = aliasGenerator.detectUsedFrameworks(registeredModules, module);
		const aliasesObject = aliasGenerator.generateForRspack(registeredModules, context.uiOutputBaseDir, module);

		let postcssConfigPath = "";
		let tailwindCssPath = "";
		if (hasTailwindEnabled(module)) {
			context.logger?.logInfo(`[${module.uiConfig.name}] Tailwind CSS habilitado, generando configuración...`);
			tailwindCssPath = await generateTailwindConfig(module, registeredModules, configDir, context.logger);
			postcssConfigPath = await generatePostCSSConfig(tailwindCssPath, configDir, context.logger);
		}

		const configContent = buildRspackConfigContent({
			context,
			safeName,
			isLayout,
			isHost,
			isProduction,
			remotes: {}, // layouts usan lazyLoadRemoteComponent; no se pre-declaran remotes
			externals: [],
			usedFrameworks,
			aliasesObject,
			postcssConfigPath,
			tailwindCssPath,
			configDir,
			appExtension: this.getFileExtension(),
			mainEntry: this.getMainEntry(),
			extensions: this.getResolveExtensions(),
			moduleRules: this.getModuleRules(isProduction, postcssConfigPath),
			plugins: this.getPlugins(context, isHost, usedFrameworks),
			imports: this.getImports(),
			experiments: this.getExperiments(),
			additionalRules: this.getAdditionalRules(),
		});

		const configPath = path.join(configDir, "rspack.config.mjs");
		await fs.writeFile(configPath, configContent, "utf-8");
		context.logger?.logDebug(`Config Rspack generado: ${configPath}`);
		return configPath;
	}

	async startDevServer(context: IBuildContext): Promise<IBuildResult> {
		const configPath = await this.generateConfig(context);
		const outputPath = path.join(context.uiOutputBaseDir, context.module.uiConfig.name);
		const mode = context.isDevelopment ? "Dev Server" : "Production Server";

		return runRspackWatcher(
			context,
			["serve", "--config", configPath],
			outputPath,
			`Iniciando Rspack dev server para ${context.module.uiConfig.name} [${context.namespace}]...`,
			`Rspack ${mode}`
		);
	}

	async buildStatic(context: IBuildContext): Promise<IBuildResult> {
		const configPath = await this.generateConfig(context);
		const outputPath = path.join(context.uiOutputBaseDir, context.module.uiConfig.name);
		const { module, namespace, isDevelopment } = context;

		const useWatch = isDevelopment && !module.uiConfig.isHost;
		if (useWatch) {
			return runRspackWatcher(
				context,
				["build", "--watch", "--config", configPath],
				outputPath,
				`Ejecutando build con watch para ${module.uiConfig.name} [${namespace}]...`,
				"Rspack Watch Build"
			);
		}

		context.logger?.logInfo(`Ejecutando build de producción para ${module.uiConfig.name} [${namespace}]...`);
		return runRspackBuild(context, ["build", "--config", configPath], outputPath);
	}

	/** Hooks abstractos para configuración específica del framework */
	protected abstract getMainEntry(): string;
	protected abstract getModuleRules(isProduction: boolean, postcssConfigPath: string): string;
	protected abstract getPlugins(context: IBuildContext, isHost: boolean, usedFrameworks: Set<string>): string;
	protected abstract getImports(): string;

	/** Bloque `experiments` (overridable; default activa css). */
	protected getExperiments(): string {
		return `
        css: true,`;
	}

	/** Reglas extra concatenadas tras `moduleRules` (overridable). */
	protected getAdditionalRules(): string {
		return `
            {
                scheme: 'data',
                mimetype: 'text/javascript',
                type: 'javascript/auto',
            },`;
	}
}
