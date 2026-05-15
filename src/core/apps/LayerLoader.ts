import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import { buildAppLoadLevels } from "./AppDependencyResolver.js";

async function isExistingFile(p: string): Promise<boolean> {
	try {
		return (await fs.stat(p)).isFile();
	} catch {
		return false;
	}
}

async function loadLevel(
	level: string[],
	loader: (entry: string) => Promise<void>,
	exclude: string[],
	fileExtension: string,
	logger: ILogger,
	isShuttingDown: () => boolean
): Promise<void> {
	if (level.length === 1) {
		await loadLayerRecursive(level[0], loader, exclude, fileExtension, logger, isShuttingDown);
		return;
	}
	logger.logDebug(`Cargando ${level.length} apps en paralelo...`);
	await Promise.all(level.map((p) => loadLayerRecursive(p, loader, exclude, fileExtension, logger, isShuttingDown)));
}

export async function loadLayerRecursive(
	dir: string,
	loader: (entry: string) => Promise<void>,
	exclude: string[],
	fileExtension: string,
	logger: ILogger,
	isShuttingDown: () => boolean
): Promise<void> {
	if (isShuttingDown()) return;
	try {
		const indexPath = path.join(dir, `index${fileExtension}`);
		if (await isExistingFile(indexPath)) {
			await loader(indexPath);
			return;
		}
		const entries = await fs.readdir(dir, { withFileTypes: true });
		const levels = await buildAppLoadLevels(dir, entries, exclude, logger);
		for (const level of levels) {
			if (isShuttingDown()) return;
			await loadLevel(level, loader, exclude, fileExtension, logger, isShuttingDown);
		}
	} catch {
		/* dir no existe */
	}
}
