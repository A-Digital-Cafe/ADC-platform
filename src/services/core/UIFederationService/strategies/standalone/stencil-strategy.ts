import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { BaseCLIStrategy } from "../base-strategy.js";
import type { IBuildContext, IBuildResult } from "../types.js";
import { getBinPath } from "../../utils/fs/path-resolver.js";
import { runCommand } from "../../utils/fs/file-operations.js";
import { generateAutoInit, regenerateReactJSX } from "../shared/stencil-output.js";
import { writeStencilConfig } from "./stencil-config.js";

const BUILD_WAIT_MAX_MS = 30000;
const BUILD_WAIT_INTERVAL_MS = 500;

/**
 * Estrategia Stencil (Web Components, CLI-based).
 * Watch mode en dev, build estático en producción.
 * Post-build genera `init.js`, `styles.css` y opcionalmente `utils/react-jsx.ts`.
 */
export class StencilStrategy extends BaseCLIStrategy {
	readonly name = "Stencil";
	readonly framework = "stencil";

	protected getFileExtension(): string {
		return ".tsx";
	}

	protected getResolveExtensions(): string[] {
		return [".tsx", ".ts", ".jsx", ".js", ".json", ".css"];
	}

	async generateConfig(context: IBuildContext): Promise<string> {
		return writeStencilConfig(context);
	}

	/** Stencil soporta watch mode en desarrollo (sin servidor HTTP). */
	protected shouldStartDevServer(context: IBuildContext): boolean {
		return context.isDevelopment;
	}

	async startDevServer(context: IBuildContext): Promise<IBuildResult> {
		const { module, uiOutputBaseDir, namespace } = context;
		const stencilBin = getBinPath("stencil");
		const outputDir = path.join(uiOutputBaseDir, module.uiConfig.name);

		await fs.mkdir(outputDir, { recursive: true });
		context.logger?.logDebug(`Iniciando Stencil build en watch mode para ${module.uiConfig.name} [${namespace}]`);
		await this.generateConfig(context);

		module.outputPath = outputDir;
		const watcher = spawn(stencilBin, ["build", "--watch"], {
			cwd: module.appDir,
			stdio: "pipe",
			shell: false,
			detached: process.platform !== "win32",
		});

		watcher.stdout?.on("data", (data: Buffer) => {
			const output = data.toString();
			if (output.includes("build finished")) {
				context.logger?.logDebug(`Stencil build actualizado para ${module.uiConfig.name} [${namespace}]`);
				Promise.all([generateAutoInit(module, context.logger), regenerateReactJSX(module, context.logger)]).catch((err) => {
					context.logger?.logDebug(`Error en post-build: ${(err as Error).message}`);
				});
			}
			if (output.includes("[ ERROR ]") || output.includes("build failed")) {
				context.logger?.logError(`Stencil build error (${module.uiConfig.name}):\n${output.trim()}`);
			}
		});

		watcher.stderr?.on("data", (data: Buffer) => {
			context.logger?.logWarn(`Stencil ${module.uiConfig.name}: ${data.toString().trim()}`);
		});

		watcher.on("error", (error: Error) => {
			context.logger?.logError(`Error en watcher Stencil ${module.uiConfig.name}: ${error.message}`);
		});

		watcher.on("exit", (code, signal) => {
			context.logger?.logDebug(`Stencil watcher ${module.uiConfig.name} terminado (code: ${code}, signal: ${signal})`);
		});

		await this.waitForInitialBuild(outputDir, module.uiConfig.name, context.logger);
		await Promise.all([generateAutoInit(module, context.logger), regenerateReactJSX(module, context.logger)]);

		return { watcher, outputPath: outputDir };
	}

	async buildStatic(context: IBuildContext): Promise<IBuildResult> {
		const { module, uiOutputBaseDir, namespace } = context;
		const stencilBin = getBinPath("stencil");
		const outputDir = path.join(uiOutputBaseDir, module.uiConfig.name);

		await fs.mkdir(outputDir, { recursive: true });
		context.logger?.logInfo(`Ejecutando build Stencil para ${module.uiConfig.name} [${namespace}]...`);

		await this.generateConfig(context);
		await runCommand(stencilBin, ["build"], module.appDir, context.logger);
		module.outputPath = outputDir;

		await Promise.all([generateAutoInit(module, context.logger), regenerateReactJSX(module, context.logger)]);
		context.logger?.logOk(`Build Stencil completado para ${module.uiConfig.name}`);

		return { outputPath: outputDir };
	}

	/** Espera al build inicial de Stencil (existencia del loader). */
	private async waitForInitialBuild(outputDir: string, name: string, logger?: any): Promise<void> {
		const loaderPath = path.join(outputDir, "loader", "index.js");
		let elapsed = 0;
		logger?.logDebug(`Esperando build inicial de Stencil para ${name}...`);

		while (elapsed < BUILD_WAIT_MAX_MS) {
			try {
				await fs.access(loaderPath);
				logger?.logDebug(`Build inicial de Stencil completado para ${name}`);
				return;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, BUILD_WAIT_INTERVAL_MS));
				elapsed += BUILD_WAIT_INTERVAL_MS;
			}
		}

		logger?.logWarn(`Timeout esperando build de Stencil para ${name}. El loader podría no estar disponible.`);
	}
}
