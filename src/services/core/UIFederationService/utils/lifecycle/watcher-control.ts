import type { ILogger } from "../../../../../interfaces/utils/ILogger.js";

const TERM_GRACE_MS = 1000;

function killProcessGroup(pid: number, logger: ILogger): void {
	try {
		process.kill(-pid, "SIGKILL");
	} catch (error: any) {
		logger.logDebug(`Error matando grupo de procesos ${pid}: ${error.message}`);
	}
}

async function killWatcher(name: string, watcher: any, logger: ILogger): Promise<void> {
	logger.logDebug(`Deteniendo watcher: ${name}`);

	if (!watcher || typeof watcher.kill !== "function") return;

	watcher.kill("SIGTERM");
	await new Promise((resolve) => setTimeout(resolve, TERM_GRACE_MS));

	if (!watcher.killed) {
		logger.logDebug(`Forzando terminación de watcher: ${name}`);
		watcher.kill("SIGKILL");
	}

	if (watcher.pid && process.platform !== "win32") {
		killProcessGroup(watcher.pid, logger);
	}
}

/** Detiene un watcher (dev server) si está activo. */
export async function stopWatcherIfRunning(watcher: any, label: string, logger: ILogger): Promise<void> {
	if (!watcher || watcher.killed) return;
	logger.logDebug(`Deteniendo dev server de ${label}...`);
	watcher.kill("SIGTERM");
	await new Promise((resolve) => setTimeout(resolve, TERM_GRACE_MS));
}

/** Detiene todos los watchers registrados y limpia el mapa. */
export async function stopAllWatchers(watchers: Map<string, any>, logger: ILogger): Promise<void> {
	for (const [name, watcher] of watchers.entries()) {
		try {
			await killWatcher(name, watcher, logger);
		} catch (error: any) {
			logger.logWarn(`Error deteniendo watcher ${name}: ${error.message}`);
		}
	}
	watchers.clear();
}
