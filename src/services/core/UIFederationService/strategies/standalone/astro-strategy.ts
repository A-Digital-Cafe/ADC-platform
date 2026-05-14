import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseCLIStrategy } from "../base-strategy.js";
import type { IBuildContext, IBuildResult } from "../types.js";
import { getBinPath } from "../../utils/fs/path-resolver.js";
import { copyDirectory, runCommand } from "../../utils/fs/file-operations.js";

/**
 * Estrategia para Astro (SSG)
 */
export class AstroStrategy extends BaseCLIStrategy {
	readonly name = "Astro";
	readonly framework = "astro";

	protected getFileExtension(): string {
		return ".astro";
	}

	protected getResolveExtensions(): string[] {
		return [".astro", ".tsx", ".ts", ".jsx", ".js", ".json", ".css"];
	}

	/**
	 * Genera la configuración de Astro
	 */
	async generateConfig(context: IBuildContext): Promise<string> {
		const { module } = context;

		const outputDir = module.uiConfig.outputDir || "dist-ui";
		const astroDefaults = {
			output: "static",
			build: { format: "file" },
		};

		const sharedLibs = module.uiConfig.sharedLibs || [];
		const needsReact = sharedLibs.includes("react");
		const needsVue = sharedLibs.includes("vue");

		const imports: string[] = ["import { defineConfig } from 'astro/config';"];
		const integrations: string[] = [];

		if (needsReact) {
			imports.push("import react from '@astrojs/react';");
			integrations.push("react()");
		}
		if (needsVue) {
			imports.push("import vue from '@astrojs/vue';");
			integrations.push("vue()");
		}

		const finalConfig = {
			...astroDefaults,
			...module.uiConfig.astroConfig,
			outDir: `./${outputDir}`,
		};

		const configContentParts: string[] = [
			``,
			imports.join("\n"),
			``,
			`export default defineConfig({`,
			`  output: "${finalConfig.output}",`,
			`  outDir: "${finalConfig.outDir}",`,
		];

		const buildConfig = {
			...finalConfig.build,
			format: "directory",
		};

		configContentParts.push(`  build: ${JSON.stringify(buildConfig)},`);

		if (integrations.length > 0) {
			configContentParts.push(`  integrations: [${integrations.join(", ")}],`);
		}

		configContentParts.push(`});`);

		const configContent = configContentParts.join("\n");

		const configPath = path.join(module.appDir, "astro.config.mjs");
		await fs.writeFile(configPath, configContent, "utf-8");

		context.logger?.logDebug(`Configuración Astro generada: ${configPath}`);
		return configPath;
	}

	/**
	 * Astro no soporta dev server en este contexto
	 */
	async startDevServer(context: IBuildContext): Promise<IBuildResult> {
		context.logger?.logWarn(`Astro no soporta dev server en UIFederationService. Ejecutando build.`);
		return this.buildStatic(context);
	}

	/**
	 * Build estático con Astro
	 */
	async buildStatic(context: IBuildContext): Promise<IBuildResult> {
		const { module, uiOutputBaseDir, namespace } = context;
		const astroBin = getBinPath("astro");

		context.logger?.logInfo(`Ejecutando build Astro para ${module.uiConfig.name} [${namespace}]...`);

		// Generar config antes del build
		await this.generateConfig(context);

		// Ejecutar build
		await runCommand(astroBin, ["build"], module.appDir, context.logger);

		// Copiar output al directorio de builds
		const sourceOutputDir = path.join(module.appDir, module.uiConfig.outputDir);
		const targetOutputDir = path.join(uiOutputBaseDir, module.uiConfig.name);

		await fs.rm(targetOutputDir, { recursive: true, force: true });
		await copyDirectory(sourceOutputDir, targetOutputDir);

		module.outputPath = targetOutputDir;

		context.logger?.logOk(`Build Astro completado para ${module.uiConfig.name}`);

		return { outputPath: targetOutputDir };
	}
}
