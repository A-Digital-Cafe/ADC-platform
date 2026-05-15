import type { Dirent } from "node:fs";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import { collectAppConfigs, type AppLoadInfo } from "./AppConfigReader.js";

function partitionByDeps(pending: AppLoadInfo[], loaded: Set<string>): { ready: AppLoadInfo[]; rest: AppLoadInfo[] } {
	const ready: AppLoadInfo[] = [];
	const rest: AppLoadInfo[] = [];
	for (const app of pending) {
		if (app.dependencies.every((d) => loaded.has(d))) ready.push(app);
		else rest.push(app);
	}
	return { ready, rest };
}

function describeMissing(stillPending: AppLoadInfo[], loaded: Set<string>): string {
	return stillPending.map((app) => `${app.name} -> [${app.dependencies.filter((d) => !loaded.has(d)).join(", ")}]`).join("; ");
}

function buildLevels(apps: AppLoadInfo[], loaded: Set<string>, maxIter: number, logger: ILogger | null): string[][] {
	const levels: string[][] = [];
	let pending = [...apps];
	for (let i = 0; i < maxIter && pending.length > 0; i++) {
		const { ready, rest } = partitionByDeps(pending, loaded);
		if (ready.length > 0) {
			levels.push(ready.map((a) => a.path));
			ready.forEach((a) => loaded.add(a.name));
			pending = rest;
			continue;
		}
		if (rest.length > 0) {
			logger?.logWarn(
				`Dependencias circulares o faltantes: ${rest.map((a) => a.name).join(", ")}. Faltantes: ${describeMissing(rest, loaded)}.`
			);
			levels.push(rest.map((a) => a.path));
			rest.forEach((a) => loaded.add(a.name));
		}
		break;
	}
	return levels;
}

export async function buildAppLoadLevels(dir: string, entries: Dirent[], exclude: string[], logger: ILogger): Promise<string[][]> {
	const apps = await collectAppConfigs(dir, entries, exclude);
	const loaded = new Set<string>();
	const levels: string[][] = [];

	const uiLibs = apps.filter((a) => a.isUILib);
	if (uiLibs.length > 0) {
		levels.push(uiLibs.map((a) => a.path));
		uiLibs.forEach((a) => loaded.add(a.name));
	}

	const hosts = apps.filter((a) => a.isHost && !a.isUILib);
	const others = apps.filter((a) => !a.isUILib && !a.isHost);

	const allLevels = [...levels, ...buildLevels(others, loaded, 50, logger), ...buildLevels(hosts, loaded, 10, null)];

	if (allLevels.length > 1) {
		const summary = allLevels.map((l, i) => "L" + i + "(" + l.length + ")").join(" -> ");
		logger.logDebug(`Niveles de carga: ${summary}`);
	}
	return allLevels;
}
