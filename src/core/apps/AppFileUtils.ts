import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IApp } from "../../interfaces/modules/IApp.js";
import type { Kernel } from "../../kernel.js";
import type { ILogger } from "../../interfaces/utils/ILogger.js";

export const FILE_EXT = ".ts";

export type AppCtor = new (kernel: Kernel, instanceName: string, config: unknown, filePath: string) => IApp;

export function getConfigName(configFile: string): string {
	const raw = path.basename(configFile, ".json");
	if (raw === "config") return "default";
	return raw.startsWith("config-") ? raw.substring("config-".length) : raw;
}

export async function readJson<T = unknown>(filePath: string): Promise<T | null> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
	} catch {
		return null;
	}
}

async function isDisabledViaFile(dir: string, fileName: string): Promise<boolean> {
	const content = await readJson<{ disabled?: boolean }>(path.join(dir, fileName));
	return content?.disabled === true;
}

export async function isAppDisabled(appDir: string, appName: string, logger: ILogger): Promise<boolean> {
	if (await isDisabledViaFile(appDir, "default.json")) {
		logger.logDebug(`App ${appName} está deshabilitada (default.json)`);
		return true;
	}
	if (await isDisabledViaFile(appDir, "config.json")) {
		logger.logDebug(`App ${appName} está deshabilitada (config.json)`);
		return true;
	}
	return false;
}

async function listConfigFiles(dir: string, logger: ILogger): Promise<string[]> {
	try {
		const files = await fs.readdir(dir);
		return files.filter((f) => f.startsWith("config") && f.endsWith(".json")).map((f) => path.join(dir, f));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
			logger.logWarn(`No se pudo leer el directorio de configuración ${dir}: ${e}`);
		}
		return [];
	}
}

export async function findConfigFiles(appDir: string, logger: ILogger): Promise<string[]> {
	const dirs = [appDir, path.join(appDir, "configs")];
	const result: string[] = [];
	for (const dir of dirs) {
		result.push(...(await listConfigFiles(dir, logger)));
	}
	return result;
}
