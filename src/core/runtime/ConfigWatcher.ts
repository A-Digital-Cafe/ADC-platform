import * as fs from "node:fs/promises";
import * as path from "node:path";
import chokidar from "chokidar";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { ModuleRegistry } from "../../utils/registry/ModuleRegistry.js";

const FILE_EXT = ".ts";

export interface ConfigWatcherDeps {
	logger: ILogger;
	registry: ModuleRegistry;
	appConfigFilePaths: ReadonlyMap<string, string>;
	removeConfigPath: (configPath: string) => void;
	appsPath: string;
	isStartingUp: () => boolean;
	isDevelopment: boolean;
	reloadAppInstance: (cfg: string) => Promise<void>;
	loadApp: (file: string) => Promise<void>;
}

export class ConfigWatcher {
	private readonly deps: Readonly<ConfigWatcherDeps>;

	constructor(deps: ConfigWatcherDeps) {
		this.deps = Object.freeze({ ...deps });
	}

	start(): void {
		const srcAppsPath = path.resolve(process.cwd(), "src", "apps");
		const patterns = [path.join(srcAppsPath, "**/*.json"), path.join(srcAppsPath, "**/configs/*.json")];

		const watcher = chokidar.watch(patterns, {
			ignoreInitial: true,
			ignored: (p) => ["default.json", "tsonfig.json"].includes(path.basename(p)),
			awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
		});

		watcher.on("change", (p) => this.#onChange(p));
		watcher.on("add", (p) => this.#onAdd(p));
		watcher.on("unlink", (p) => this.#onUnlink(p, srcAppsPath));
	}

	async #onChange(srcConfigPath: string): Promise<void> {
		if (this.deps.isStartingUp()) return;
		this.deps.logger.logInfo(`Detectado cambio en configuración: ${path.basename(srcConfigPath)}`);
		await this.deps.reloadAppInstance(srcConfigPath);
	}

	async #onAdd(srcConfigPath: string): Promise<void> {
		if (this.deps.isStartingUp()) return;
		const appDir = srcConfigPath.includes("/configs/") ? path.dirname(path.dirname(srcConfigPath)) : path.dirname(srcConfigPath);
		const appFilePath = path.join(appDir, `index${FILE_EXT}`);
		try {
			await fs.stat(appFilePath);
			this.deps.logger.logInfo(`Nuevo archivo de configuración detectado: ${path.basename(srcConfigPath)}`);
			await this.deps.loadApp(appFilePath);
		} catch {
			/* app no existe */
		}
	}

	async #onUnlink(srcConfigPath: string, srcAppsPath: string): Promise<void> {
		if (this.deps.isStartingUp()) return;
		const targetConfigPath = await this.#resolveDeletedConfigPath(srcConfigPath, srcAppsPath);
		const instanceName = this.deps.appConfigFilePaths.get(targetConfigPath);
		if (!instanceName) return;
		this.deps.logger.logInfo(`Archivo de configuración eliminado: ${path.basename(srcConfigPath)}`);
		if (this.deps.registry.hasApp(instanceName)) {
			const app = this.deps.registry.getApp(instanceName);
			await app.stop?.();
			this.deps.registry.deleteApp(instanceName);
		}
		this.deps.removeConfigPath(targetConfigPath);
	}

	async #resolveDeletedConfigPath(srcConfigPath: string, srcAppsPath: string): Promise<string> {
		if (this.deps.isDevelopment) return srcConfigPath;
		const relativePath = path.relative(srcAppsPath, srcConfigPath);
		const target = path.join(this.deps.appsPath, relativePath);
		try {
			await fs.unlink(target);
		} catch {
			/* archivo no existe */
		}
		return target;
	}
}

export function watchLayer(
	dir: string,
	fileExtension: string,
	loader: (p: string) => Promise<void>,
	unloader: (p: string) => Promise<void>,
	isStartingUp: () => boolean,
	exclude: string[] = [],
	onChange?: (p: string) => Promise<void>
): void {
	const watcher = chokidar.watch(path.join(dir, `**/index${fileExtension}`), {
		ignoreInitial: true,
		ignored: exclude,
		awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
	});
	watcher.on("add", (p) => {
		if (!isStartingUp()) loader(p);
	});
	watcher.on("change", async (p) => {
		if (isStartingUp()) return;
		if (onChange) {
			await onChange(p);
			return;
		}
		await unloader(p);
		await loader(p);
	});
	watcher.on("unlink", (p) => {
		if (!isStartingUp()) unloader(p);
	});
}
