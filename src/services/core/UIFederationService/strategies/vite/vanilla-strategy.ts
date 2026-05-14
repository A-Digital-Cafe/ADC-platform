import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { ViteBaseStrategy } from "./base.js";
import type { IBuildContext, IBuildResult } from "../types.js";
import { copyDirectory } from "../../utils/fs/file-operations.js";
import { getBinPath } from "../../utils/fs/path-resolver.ts";
import { createImportMapPlugin, createFederationResolverPlugin } from "../shared/vite-federation.js";

/**
 * Estrategia Vite para JavaScript Vanilla
 * Esta estrategia NO requiere devPort y puede hacer watch builds
 */
export class VanillaViteStrategy extends ViteBaseStrategy {
	readonly name = "Vanilla JS (Vite)";
	readonly framework = "vanilla";

	/**
	 * Vanilla Vite no requiere devPort obligatoriamente
	 */
	requiresDevPort(): boolean {
		return false;
	}

	protected getFileExtension(): string {
		return ".js";
	}

	protected getResolveExtensions(): string[] {
		return [".js", ".json", ".css"];
	}

	protected getOptimizeDepsInclude(): string[] {
		return [];
	}

	protected getGlobals(): Record<string, string> {
		return {};
	}

	/**
	 * Override: determina si debe iniciar dev server
	 * Para vanilla, solo si tiene devPort explícito
	 */
	protected shouldStartDevServer(context: IBuildContext): boolean {
		return !!(context.module.uiConfig.devPort && context.isDevelopment);
	}

	/**
	 * Override buildStatic para soportar watch mode
	 */
	async buildStatic(context: IBuildContext): Promise<IBuildResult> {
		const { module, uiOutputBaseDir, isDevelopment, namespace } = context;
		const viteBin = getBinPath("vite");

		if (isDevelopment) {
			// Watch mode
			context.logger?.logDebug(`Iniciando Vite build en watch mode para ${module.uiConfig.name} [${namespace}]`);

			const spawnOptions: any = {
				cwd: module.appDir,
				stdio: "pipe",
				shell: false,
				detached: process.platform !== "win32",
			};

			const watcher = spawn(viteBin, ["build", "--watch"], spawnOptions);

			watcher.stdout?.on("data", (data: Buffer) => {
				const output = data.toString();
				if (output.includes("built in")) {
					context.logger?.logDebug(`Vite build actualizado para ${module.uiConfig.name} [${namespace}]`);
				}
			});

			watcher.stderr?.on("data", (data: Buffer) => {
				context.logger?.logDebug(`Vite watch ${module.uiConfig.name}: ${data.toString().slice(0, 200)}`);
			});

			watcher.on("error", (error: Error) => {
				context.logger?.logError(`Error en watcher Vite ${module.uiConfig.name}: ${error.message}`);
			});

			// Esperar a que el build inicial termine
			await new Promise((resolve) => setTimeout(resolve, 3000));

			const sourceOutputDir = path.join(module.appDir, module.uiConfig.outputDir);
			const targetOutputDir = path.join(uiOutputBaseDir, module.uiConfig.name);
			await fs.rm(targetOutputDir, { recursive: true, force: true });
			await copyDirectory(sourceOutputDir, targetOutputDir);
			module.outputPath = targetOutputDir;

			return { watcher, outputPath: targetOutputDir };
		} else {
			// Build de producción normal
			return super.buildStatic(context);
		}
	}

	protected async getVitePlugins(context: IBuildContext, isDev: boolean): Promise<any[]> {
		const plugins: any[] = [];

		if (isDev) {
			plugins.push(createImportMapPlugin(context), createFederationResolverPlugin(context));
		}

		return plugins;
	}
}
