import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { BaseCLIStrategy } from "../base-strategy.js";
import type { IBuildContext, IBuildResult } from "../types.js";
import { getBinPath } from "../../utils/fs/path-resolver.js";
import { runCommand } from "../../utils/fs/file-operations.js";
import { generateAutoInit, regenerateReactJSX, cleanupStrayEmits } from "../shared/stencil-output.js";
import { writeStencilConfig } from "./stencil-config.js";
import { bootTimeline } from "../../../../../utils/system/BootTimeline.ts";

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
		const spawnedAt = Date.now();
		const watcher = spawn(stencilBin, ["build", "--watch"], {
			cwd: module.appDir,
			stdio: "pipe",
			shell: false,
			detached: process.platform !== "win32",
		});
		bootTimeline.trackChild(watcher.pid, `stencil:${module.uiConfig.name}`);

		// Señal REAL de que el primer build terminó: la sola existencia del loader no alcanza
		// (existe en cualquier árbol ya compilado) y aceptarla marca `built` mientras Stencil
		// sigue compilando, con los hijos rspack bundleando contra un `init.js`/`styles.css` viejo.
		let signalFirstBuild: (outcome: "built" | "failed") => void = () => {};
		const firstBuild = new Promise<"built" | "failed">((resolve) => {
			signalFirstBuild = resolve;
		});

		watcher.stdout?.on("data", (data: Buffer) => {
			const output = data.toString();
			if (output.includes("build finished")) {
				context.logger?.logDebug(`Stencil build actualizado para ${module.uiConfig.name} [${namespace}]`);
				Promise.all([generateAutoInit(module, context.logger), regenerateReactJSX(module, context.logger), cleanupStrayEmits(context.logger)])
					.catch((err) => {
						context.logger?.logDebug(`Error en post-build: ${(err as Error).message}`);
					})
					.finally(() => signalFirstBuild("built"));
			}
			if (output.includes("[ ERROR ]") || output.includes("build failed")) {
				context.logger?.logError(`Stencil build error (${module.uiConfig.name}):\n${output.trim()}`);
				// Un build roto no puede quedarse 30 s bloqueando a todos sus consumidores.
				signalFirstBuild("failed");
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

		await this.waitForInitialBuild({ firstBuild, outputDir, name: module.uiConfig.name, spawnedAt, logger: context.logger });
		await Promise.all([generateAutoInit(module, context.logger), regenerateReactJSX(module, context.logger), cleanupStrayEmits(context.logger)]);

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

		await Promise.all([generateAutoInit(module, context.logger), regenerateReactJSX(module, context.logger), cleanupStrayEmits(context.logger)]);
		context.logger?.logOk(`Build Stencil completado para ${module.uiConfig.name}`);

		return { outputPath: outputDir };
	}

	/**
	 * Espera al build inicial de Stencil. Gana el primero de tres:
	 *
	 *  1. la línea `build finished` de stdout (la señal autoritativa);
	 *  2. un loader en disco **más nuevo que el spawn** — fallback por si el formato del
	 *     mensaje cambia; el chequeo de `mtimeMs` es lo que impide aceptar el build viejo;
	 *  3. el techo de 30 s, que avisa y deja seguir.
	 */
	private async waitForInitialBuild(opts: {
		firstBuild: Promise<"built" | "failed">;
		outputDir: string;
		name: string;
		spawnedAt: number;
		logger?: any;
	}): Promise<void> {
		const { firstBuild, outputDir, name, spawnedAt, logger } = opts;
		logger?.logDebug(`Esperando build inicial de Stencil para ${name}...`);

		const winner = await Promise.race([
			firstBuild.then((outcome) => (outcome === "built" ? "stdout" : "stdout-error")),
			this.#pollFreshLoader(path.join(outputDir, "loader", "index.js"), spawnedAt),
		]);

		if (winner === "timeout") {
			logger?.logWarn(`Timeout esperando build de Stencil para ${name}. El loader podría no estar disponible.`);
			return;
		}
		if (winner === "stdout-error") {
			logger?.logWarn(`Build inicial de Stencil para ${name} terminó con errores; sus consumidores siguen igual.`);
			return;
		}
		logger?.logDebug(`Build inicial de Stencil completado para ${name} (señal: ${winner})`);
	}

	/** Poll del loader exigiendo `mtimeMs >= spawnedAt`: existir no alcanza, tiene que ser de ESTA corrida. */
	async #pollFreshLoader(loaderPath: string, spawnedAt: number): Promise<"mtime" | "timeout"> {
		for (let elapsed = 0; elapsed < BUILD_WAIT_MAX_MS; elapsed += BUILD_WAIT_INTERVAL_MS) {
			try {
				const stat = await fs.stat(loaderPath);
				if (stat.mtimeMs >= spawnedAt) return "mtime";
			} catch {
				/* todavía no existe */
			}
			await new Promise((resolve) => setTimeout(resolve, BUILD_WAIT_INTERVAL_MS));
		}
		return "timeout";
	}
}
