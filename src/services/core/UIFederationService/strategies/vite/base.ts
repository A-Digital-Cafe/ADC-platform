import * as path from "node:path";
import { build, type InlineConfig } from "vite";
import { BaseFrameworkStrategy } from "../base-strategy.js";
import type { BundlerType, IBuildContext, IBuildResult } from "../types.js";
import aliasGenerator from "../../utils/bundler/alias-generator.js";
import { copyPublicFiles } from "../../utils/fs/file-operations.js";
import { createStaticAssetsPlugin, createCommonPublicFallbackPlugin } from "../shared/vite-static.js";
import { buildViteBuildConfig, startViteDevServer, startVitePreviewServer } from "../shared/vite-server.js";

/**
 * Clase base para estrategias Vite. Orquesta build/dev/preview;
 * delega plugins comunes a `shared/vite-*`.
 */
export abstract class ViteBaseStrategy extends BaseFrameworkStrategy {
	readonly bundler: BundlerType = "vite";

	async generateConfig(_context: IBuildContext): Promise<string> {
		// Vite usa API programática; no escribe archivo en disco.
		return "vite-programmatic";
	}

	/** Construye la `InlineConfig` para `createServer`/`build`/`preview`. */
	protected async getViteConfig(context: IBuildContext, isDev: boolean): Promise<InlineConfig> {
		const { module, registeredModules, uiOutputBaseDir } = context;
		const config = module.uiConfig;
		const outputDir = path.join(uiOutputBaseDir, config.name);
		const isHost = config.isHost ?? false;

		const plugins = await this.getVitePlugins(context, isDev);
		const dynamicAliases = aliasGenerator.generate(registeredModules, uiOutputBaseDir, module);

		// Módulos federados: excluidos del optimizeDeps y marcados como externals.
		const federatedModules: string[] = [];
		const externalModules: string[] = [];
		for (const moduleName of registeredModules.keys()) {
			federatedModules.push(`@${moduleName}`);
			externalModules.push(`@${moduleName}`, moduleName, `${moduleName}/App`, `${moduleName}/App.js`);
		}
		const externals: (string | RegExp)[] = isDev ? [] : externalModules;

		const buildConfig = buildViteBuildConfig(module, isHost, outputDir, externals, this.getFileExtension(), this.getGlobals());

		const staticAssetsPlugin = createStaticAssetsPlugin(context);
		if (staticAssetsPlugin) plugins.push(staticAssetsPlugin);
		const commonFallbackPlugin = createCommonPublicFallbackPlugin();
		if (commonFallbackPlugin) plugins.push(commonFallbackPlugin);

		const devPort = config.devPort || 0;
		return {
			configFile: false,
			root: module.appDir,
			base: isDev ? "/" : `/${config.name}/`,
			publicDir: path.join(module.appDir, "public"),
			plugins,
			resolve: {
				alias: dynamicAliases,
				extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
			},
			server: {
				host: true,
				port: devPort,
				strictPort: true,
				// Dev server: limitar CORS a orígenes locales conocidos. "*" + credentials es
				// inválido según spec y expondría el dev server a cualquier web abierta.
				cors: { origin: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w.-]+\.local\.com)(:\d+)?$/, credentials: true },
				hmr: { protocol: "ws", clientPort: devPort },
			},
			optimizeDeps: {
				include: isDev ? this.getOptimizeDepsInclude() : [],
				exclude: federatedModules,
			},
			define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production") },
			build: buildConfig,
		};
	}

	async startDevServer(context: IBuildContext): Promise<IBuildResult> {
		if (context.isDevelopment) {
			return startViteDevServer(context, await this.getViteConfig(context, true));
		}

		// Producción local: build + preview
		context.logger?.logInfo(`Build + Preview Vite para ${context.module.uiConfig.name} [${context.namespace}]...`);
		const buildResult = await this.buildStatic(context);
		const viteConfig = await this.getViteConfig(context, false);
		return startVitePreviewServer(context, viteConfig, buildResult.outputPath);
	}

	async buildStatic(context: IBuildContext): Promise<IBuildResult> {
		const { module, uiOutputBaseDir } = context;

		context.logger?.logInfo(`Ejecutando build Vite para ${module.uiConfig.name}...`);
		const viteConfig = await this.getViteConfig(context, false);
		await build(viteConfig);

		const outputPath = path.join(uiOutputBaseDir, module.uiConfig.name);
		module.outputPath = outputPath;

		await copyPublicFiles(module.appDir, outputPath, context.logger);
		context.logger?.logOk(`Build completado para ${module.uiConfig.name}`);
		return { outputPath };
	}

	/** Hooks abstractos específicos del framework */
	protected abstract getVitePlugins(context: IBuildContext, isDev: boolean): Promise<any[]>;
	protected abstract getOptimizeDepsInclude(): string[];
	protected abstract getGlobals(): Record<string, string>;
}
