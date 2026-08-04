import type { ILogger } from "../../../../../interfaces/utils/ILogger.js";

const TERM_GRACE_MS = 1000;

function killProcessGroup(pid: number, logger: ILogger): void {
	try {
		process.kill(-pid, "SIGKILL");
	} catch (error: any) {
		logger.logDebug(`Error matando grupo de procesos ${pid}: ${error.message}`);
	}
}

/**
 * Espera a que el hijo salga de verdad, o hasta `TERM_GRACE_MS`.
 *
 * No se puede usar `watcher.killed` como test de vida: Node lo pone en `true` en cuanto
 * **envía** la señal, no cuando el proceso muere. El estado real es `exitCode`/`signalCode`
 * (ambos `null` mientras corre). Los watchers falsos de Vite no tienen ninguno de los dos,
 * así que caen por el `!== null` y se dan por terminados sin esperar.
 */
async function waitForExit(watcher: any): Promise<boolean> {
	if (watcher.exitCode !== null || watcher.signalCode !== null) return true;
	if (typeof watcher.once !== "function") return true;

	return new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => resolve(false), TERM_GRACE_MS);
		watcher.once("exit", () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

/**
 * Termina un watcher (dev server / build en watch) y **no vuelve hasta que no queda
 * proceso**: SIGTERM → espera la salida real → SIGKILL → kill del grupo entero.
 *
 * El kill de grupo no es redundante: los bundlers se spawnean con `detached: true`
 * (ver `strategies/shared/rspack-process.ts`), así que matar sólo al líder deja vivos
 * a sus hijos, que siguen ocupando el `devPort`.
 *
 * Tolera los watchers falsos de Vite (`{ kill: () => server.close() }`), que no tienen
 * `pid`, `exitCode` ni emisor de eventos, y cuyo `kill` devuelve una promesa.
 */
export async function stopWatcher(name: string, watcher: any, logger: ILogger): Promise<void> {
	logger.logDebug(`Deteniendo watcher: ${name}`);

	if (!watcher || typeof watcher.kill !== "function") return;

	await watcher.kill("SIGTERM");

	if (!(await waitForExit(watcher))) {
		logger.logDebug(`Forzando terminación de watcher: ${name}`);
		await watcher.kill("SIGKILL");
	}

	if (watcher.pid && process.platform !== "win32") {
		killProcessGroup(watcher.pid, logger);
	}
}

/** Detiene un watcher (dev server) si está activo. */
export async function stopWatcherIfRunning(watcher: any, label: string, logger: ILogger): Promise<void> {
	if (!watcher || watcher.killed) return;
	logger.logDebug(`Deteniendo dev server de ${label}...`);
	await stopWatcher(label, watcher, logger);
}

/** Detiene todos los watchers registrados y limpia el mapa. */
export async function stopAllWatchers(watchers: Map<string, any>, logger: ILogger): Promise<void> {
	for (const [name, watcher] of watchers.entries()) {
		try {
			await stopWatcher(name, watcher, logger);
		} catch (error: any) {
			logger.logWarn(`Error deteniendo watcher ${name}: ${error.message}`);
		}
	}
	watchers.clear();
}
