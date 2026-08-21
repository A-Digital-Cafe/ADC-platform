import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { IBuildContext, IBuildResult } from "../types.js";
import { getBinPath, getLogsDir } from "../../utils/fs/path-resolver.js";
import { waitForRspackReady } from "./readiness.js";
import { bootTimeline } from "../../../../../utils/system/BootTimeline.ts";

/**
 * Lanza rspack con un set de argumentos y retorna el watcher.
 * Centraliza la lógica de logs, handlers y warm-up usada por
 * `startDevServer` (rspack serve) y la rama watch de `buildStatic` (rspack build --watch).
 */
export async function runRspackWatcher(
	context: IBuildContext,
	args: string[],
	outputPath: string,
	startMessage: string,
	successLabel: string
): Promise<IBuildResult> {
	const { module, namespace } = context;
	const rspackBin = getBinPath("rspack");
	const logName = `${namespace}-${module.uiConfig.name}`;

	context.logger?.logInfo(startMessage);

	const logsDir = getLogsDir();
	await fs.mkdir(logsDir, { recursive: true });
	const logFile = path.join(logsDir, `${logName}.log`);
	await fs.appendFile(logFile, `\n--- Start of Session: ${new Date().toISOString()} ---\n`);

	const spawnOptions: any = { cwd: module.appDir, stdio: "pipe", shell: false };
	if (process.platform !== "win32") spawnOptions.detached = true;

	const spawnedAt = Date.now();
	const watcher = spawn(rspackBin, args, spawnOptions);
	bootTimeline.trackChild(watcher.pid, `rspack:${module.uiConfig.name}`);

	const appendSafe = (data: any) => fs.appendFile(logFile, data).catch(() => {});
	watcher.stdout?.on("data", appendSafe);
	watcher.stderr?.on("data", appendSafe);

	watcher.on("error", (error) => {
		context.logger?.logError(`Error en watcher Rspack ${module.uiConfig.name}: ${error.message}`);
		module.buildStatus = "error";
		appendSafe(`[ERROR] Spawn error: ${error.message}\n`);
	});

	watcher.on("exit", (code, signal) => {
		appendSafe(`Rspack watcher terminated (code: ${code}, signal: ${signal})\n`);
		if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGKILL" && signal !== "SIGINT") {
			context.logger?.logWarn(`Rspack watcher ${module.uiConfig.name} terminado inesperadamente. Ver logs: ${logFile}`);
			module.buildStatus = "error";
		}
	});

	context.logger?.logOk(
		`${module.uiConfig.name} [${namespace}] ${successLabel} iniciado. Logs: ${path.relative(process.cwd(), logFile)}`
	);

	// Readiness real, no un sleep fijo: sería a la vez demasiado (un compile caliente
	// termina antes) y demasiado poco (uno frío no llega, y el host que depende de este
	// módulo bundlea contra un output a medias).
	// `serve` es el único modo que abre puerto; `build --watch` sólo escribe a disco.
	const devPort = args[0] === "serve" ? module.uiConfig.devPort : undefined;
	const end = bootTimeline.phase(`ready:${module.uiConfig.name}`);
	const arm = await waitForRspackReady({ watcher, devPort, outputPath, spawnedAt });
	end();
	const elapsed = Date.now() - spawnedAt;
	if (arm === "timeout") {
		context.logger?.logWarn(`${module.uiConfig.name} [${namespace}] no reportó readiness en ${elapsed}ms; se continúa igual.`);
	} else if (elapsed > SLOW_RSPACK_MS) {
		context.logger?.logWarn(
			`${module.uiConfig.name} [${namespace}] tardó ${elapsed}ms en estar listo (esperado < ${SLOW_RSPACK_MS}ms). ` +
				`Revisar la caché persistente y el config generado antes de culpar al bundler.`
		);
	} else {
		context.logger?.logDebug(`${module.uiConfig.name} [${namespace}] listo en ${elapsed}ms (brazo: ${arm}).`);
	}

	return { watcher, outputPath };
}

/**
 * Guardia de regresión sobre el config generado (ver `docs/architecture/boot-performance.md`): en
 * caliente un hijo de rspack está entre 218 y 720 ms. Holgado a propósito — un clone frío tarda más.
 */
const SLOW_RSPACK_MS = 3000;

/**
 * Ejecuta un build de producción de rspack (sin watch), espera a que termine.
 */
export function runRspackBuild(context: IBuildContext, args: string[], outputPath: string): Promise<IBuildResult> {
	const { module } = context;
	const rspackBin = getBinPath("rspack");

	return new Promise((resolve, reject) => {
		const proc = spawn(rspackBin, args, { cwd: module.appDir, stdio: "pipe", shell: false });
		// Se leen las DOS salidas: rspack reporta los errores de compilación por stdout, no por
		// stderr, así que mirar sólo stderr dejaba el diagnóstico vacío en el único momento en que
		// hace falta. Además, un pipe que nadie drena puede trabar al hijo si se llena.
		let stdout = "";
		let stderr = "";

		proc.stdout?.on("data", (data) => {
			stdout += data.toString();
		});
		proc.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (code === 0) {
				context.logger?.logOk(`Build completado para ${module.uiConfig.name}`);
				resolve({ outputPath });
			} else {
				// La COLA, no la cabeza: el arranque de rspack es banner y progreso, y el detalle del
				// fallo queda al final. Cortar los primeros 500 caracteres tapaba justo el error.
				const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
				context.logger?.logError(`Build falló para ${module.uiConfig.name}`);
				context.logger?.logError(`Salida de rspack:\n${output.slice(-4000) || "(sin salida)"}`);
				reject(new Error(`Rspack build falló con código ${code}`));
			}
		});

		proc.on("error", reject);
	});
}
