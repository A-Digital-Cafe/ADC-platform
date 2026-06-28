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
