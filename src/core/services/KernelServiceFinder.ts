import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface KernelServiceInfo {
	path: string;
	name: string;
	configPath: string;
	priority: number;
}

interface ServiceConfig {
	kernelMode?: boolean | number;
	[key: string]: unknown;
}

function getPriority(config: ServiceConfig): number | null {
	const km = config?.kernelMode;
	if (km === true) return 1;
	if (typeof km === "number") return km;
	return null;
}

async function readConfig(configPath: string): Promise<ServiceConfig | null> {
	try {
		await fs.access(configPath);
		return JSON.parse(await fs.readFile(configPath, "utf-8"));
	} catch {
		return null;
	}
}

async function resolveIndexPath(dir: string): Promise<string | null> {
	for (const candidate of ["index.ts", "index.js"]) {
		const p = path.join(dir, candidate);
		try {
			await fs.access(p);
			return p;
		} catch {
			/* not found */
		}
	}
	return null;
}

async function inspectDir(fullPath: string, name: string): Promise<KernelServiceInfo | null> {
	const configPath = path.join(fullPath, "config.json");
	const config = await readConfig(configPath);
	if (!config) return null;
	const priority = getPriority(config);
	if (priority === null) return null;
	const indexPath = await resolveIndexPath(fullPath);
	if (!indexPath) return null;
	return { path: indexPath, name, configPath, priority };
}

async function traverse(currentDir: string, acc: KernelServiceInfo[]): Promise<void> {
	const entries = await fs.readdir(currentDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const fullPath = path.join(currentDir, entry.name);
		const info = await inspectDir(fullPath, entry.name);
		if (info) acc.push(info);
		else await traverse(fullPath, acc);
	}
}

export async function findKernelServices(dir: string): Promise<KernelServiceInfo[]> {
	const acc: KernelServiceInfo[] = [];
	try {
		await traverse(dir, acc);
	} catch {
		// El directorio no existe (ej. preset opcional). No es error.
	}
	return acc.sort((a, b) => a.priority - b.priority);
}
