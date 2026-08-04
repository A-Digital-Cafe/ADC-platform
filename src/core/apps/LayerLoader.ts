import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import { buildAppLoadLevels } from "./AppDependencyResolver.js";

export interface LayerLoadOptions {
	loader: (entry: string) => Promise<void>;
	exclude: string[];
	fileExtension: string;
	logger: ILogger;
	isShuttingDown: () => boolean;
	/**
	 * Acota cuántas unidades de carga corren a la vez. Sin `gate` el nivel se carga con
	 * paralelismo completo; con él, **todas** las ramas (capas de `src` y presets)
	 * comparten un único techo, que es lo que hace real la cota del semáforo.
	 */
	gate?: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}

async function isExistingFile(p: string): Promise<boolean> {
	try {
		return (await fs.stat(p)).isFile();
	} catch {
		return false;
	}
}

async function loadLevel(level: string[], options: LayerLoadOptions): Promise<void> {
	if (level.length === 1) {
		await loadLayerRecursive(level[0], options);
		return;
	}
	options.logger.logDebug(`Cargando ${level.length} apps en paralelo...`);
	// `allSettled`: una app que lanza no puede cancelar a sus hermanas del mismo nivel
	// (un reject de `Promise.all` caería en el `catch` de abajo, que lo traga en silencio).
	const results = await Promise.allSettled(level.map((p) => loadLayerRecursive(p, options)));
	for (const [index, result] of results.entries()) {
		if (result.status === "rejected") {
			options.logger.logError(`Error cargando ${path.basename(level[index])}: ${result.reason?.message ?? result.reason}`);
		}
	}
}

export async function loadLayerRecursive(dir: string, options: LayerLoadOptions): Promise<void> {
	if (options.isShuttingDown()) return;
	try {
		const indexPath = path.join(dir, `index${options.fileExtension}`);
		if (await isExistingFile(indexPath)) {
			const load = () => options.loader(indexPath);
			await (options.gate ? options.gate(path.basename(dir), load) : load());
			return;
		}
		const entries = await fs.readdir(dir, { withFileTypes: true });
		const levels = await buildAppLoadLevels(dir, entries, options.exclude, options.logger);
		for (const level of levels) {
			if (options.isShuttingDown()) return;
			await loadLevel(level, options);
		}
	} catch {
		/* dir no existe */
	}
}
