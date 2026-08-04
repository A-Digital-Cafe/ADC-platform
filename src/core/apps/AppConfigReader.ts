import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { moduleConfigCheck } from "@common/schemas/module-config.ts";

export interface AppLoadInfo {
	path: string;
	dirName: string;
	name: string;
	dependencies: string[];
	isUILib: boolean;
	isHost: boolean;
	isRemote: boolean;
}

interface UiModuleConfig {
	name?: string;
	framework?: string;
	exports?: unknown;
	isHost?: boolean;
	isRemote?: boolean;
	uiDependencies?: string[];
}

function makeAppInfo(subDirPath: string, dirName: string, overrides: Partial<AppLoadInfo> = {}): AppLoadInfo {
	return {
		path: subDirPath,
		dirName,
		name: dirName,
		dependencies: [],
		isUILib: false,
		isHost: false,
		isRemote: false,
		...overrides,
	};
}

function fromUiConfig(subDirPath: string, dirName: string, uiModule: UiModuleConfig): AppLoadInfo {
	return {
		path: subDirPath,
		dirName,
		name: uiModule.name || dirName,
		dependencies: uiModule.uiDependencies || [],
		isUILib: uiModule.framework === "stencil" && !!uiModule.exports,
		isHost: uiModule.isHost ?? false,
		isRemote: uiModule.isRemote ?? false,
	};
}

async function readAppConfig(subDirPath: string, dirName: string): Promise<AppLoadInfo> {
	try {
		const content = await fs.readFile(path.join(subDirPath, "config.json"), "utf-8");
		const config = safeParseJson(content, moduleConfigCheck);
		const uiModule = (config as { uiModule?: UiModuleConfig } | null)?.uiModule;
		if (uiModule) return fromUiConfig(subDirPath, dirName, uiModule);
		return makeAppInfo(subDirPath, dirName);
	} catch {
		return makeAppInfo(subDirPath, dirName);
	}
}

export async function collectAppConfigs(dir: string, entries: Dirent[], exclude: string[]): Promise<AppLoadInfo[]> {
	const results: AppLoadInfo[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || exclude.includes(entry.name)) continue;
		results.push(await readAppConfig(path.join(dir, entry.name), entry.name));
	}
	return results;
}

async function isExistingFile(filePath: string): Promise<boolean> {
	try {
		return (await fs.stat(filePath)).isFile();
	} catch {
		return false;
	}
}

/**
 * Todas las apps bajo una capa, bajando por los grupos igual que `loadLayerRecursive`:
 * un directorio con `index<ext>` ES una app; cualquier otro es un grupo por el que hay que
 * seguir bajando.
 *
 * `collectAppConfigs` es plano y eso alcanza para el cargador (que recurre por su cuenta),
 * pero no para razonar sobre el árbol entero: sobre `src/apps` devolvería `public` y `test`
 * —los grupos— en vez de las apps. Lo usa el allowlist de carga, que necesita el conjunto
 * completo para cerrar `uiDependencies` a través de capas.
 */
export async function collectAppConfigsRecursive(dir: string, exclude: string[], fileExtension: string): Promise<AppLoadInfo[]> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return []; // capa inexistente (preset sin `apps/`)
	}

	const results: AppLoadInfo[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || exclude.includes(entry.name)) continue;
		const subDir = path.join(dir, entry.name);
		if (await isExistingFile(path.join(subDir, `index${fileExtension}`))) {
			results.push(await readAppConfig(subDir, entry.name));
		} else {
			results.push(...(await collectAppConfigsRecursive(subDir, exclude, fileExtension)));
		}
	}
	return results;
}
