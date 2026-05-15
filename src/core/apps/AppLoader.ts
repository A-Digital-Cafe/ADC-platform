import * as path from "node:path";
import type { IApp } from "../../interfaces/modules/IApp.js";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { Kernel } from "../../kernel.js";
import type { ModuleRegistry } from "../../utils/registry/ModuleRegistry.js";
import type { DockerManager } from "../../utils/system/DockerManager.js";
import { findConfigFiles, getConfigName, isAppDisabled, readJson, type AppCtor } from "./AppFileUtils.js";
import { AppInstanceTracker } from "./AppInstanceTracker.js";
import { AppLifecycle } from "./AppLifecycle.js";
import { AppReloader } from "./AppReloader.js";

const RETRY_LOAD_MS = 30_000;

interface LoadErrorLike extends Error {
	code?: string;
}

export class AppLoader {
	readonly #tracker = new AppInstanceTracker();
	readonly #lifecycle: AppLifecycle;
	readonly #reloader: AppReloader;
	readonly #kernelKey: symbol;

	constructor(
		private readonly kernel: Kernel,
		private readonly registry: ModuleRegistry,
		private readonly dockerManager: DockerManager,
		private readonly logger: ILogger,
		kernelKey: symbol,
		private readonly isShuttingDown: () => boolean
	) {
		this.#kernelKey = kernelKey;
		this.#lifecycle = new AppLifecycle({ registry, tracker: this.#tracker, logger, kernelKey, isShuttingDown });
		this.#reloader = new AppReloader({ kernel, tracker: this.#tracker, lifecycle: this.#lifecycle, logger });
	}

	get appFilePaths(): ReadonlyMap<string, string> {
		return this.#tracker.appFilePaths;
	}

	get appConfigFilePaths(): ReadonlyMap<string, string> {
		return this.#tracker.appConfigFilePaths;
	}

	removeConfigPath(configPath: string): void {
		this.#tracker.removeConfigPath(configPath);
	}

	reloadAppInstance = (configPath: string): Promise<void> => this.#reloader.reloadAppInstance(configPath);
	reloadAppByInstanceName = (instanceName: string): Promise<void> => this.#reloader.reloadAppByInstanceName(instanceName);

	loadApp = async (filePath: string): Promise<void> => {
		if (this.isShuttingDown()) {
			this.logger.logInfo("Cierre en progreso, abortando carga de app...");
			return;
		}
		try {
			await this.#tryLoadApp(filePath);
		} catch (e) {
			this.#handleLoadError(filePath, e as LoadErrorLike);
		}
	};

	async #tryLoadApp(filePath: string): Promise<void> {
		const module = await import(`${filePath}?v=${Date.now()}`);
		const AppClass: AppCtor | undefined = module.default;
		if (!AppClass) return;

		const appDir = path.dirname(filePath);
		const appName = path.basename(appDir);

		if (await isAppDisabled(appDir, appName, this.logger)) return;

		try {
			await this.dockerManager.startDockerCompose(appDir, appName);
		} catch {
			this.logger.logDebug(`docker-compose no disponible para ${appName}`);
		}

		const configFiles = await findConfigFiles(appDir, this.logger);

		if (configFiles.length === 0) {
			const app: IApp = new AppClass(this.kernel, appName, undefined, filePath);
			await this.#lifecycle.initializeAndRunApp(app, filePath, appName);
			return;
		}

		for (const configPath of configFiles) {
			await this.#tryLoadInstance(AppClass, filePath, appName, configPath);
		}
	}

	async #tryLoadInstance(AppClass: AppCtor, filePath: string, appName: string, configPath: string): Promise<void> {
		const config = await readJson<{ disabled?: boolean }>(configPath);
		if (!config) return;
		if (config.disabled === true) {
			this.logger.logDebug(`App ${appName} está deshabilitada (config: ${path.basename(configPath)})`);
			return;
		}
		const instanceName = `${appName}:${getConfigName(path.basename(configPath))}`;
		const app: IApp = new AppClass(this.kernel, instanceName, config, filePath);
		await this.#lifecycle.initializeAndRunApp(app, filePath, instanceName, configPath);
	}

	#handleLoadError(filePath: string, e: LoadErrorLike): void {
		if (e?.code === "ERR_MODULE_NOT_FOUND") {
			this.logger.logError(`Faltan dependencias de Node.js para la app en ${filePath}. Reintentando en 30 segundos...`);
			this.logger.logError(String(e));
			setTimeout(() => this.loadApp(filePath), RETRY_LOAD_MS);
		} else {
			this.logger.logError(`Error ejecutando App ${filePath}: ${e}`);
		}
	}

	unloadApp = async (filePath: string): Promise<void> => {
		const keys = this.#tracker.findFileKeysByPrefix(filePath);
		for (const key of keys) {
			await this.#unloadByKey(key);
		}
	};

	async #unloadByKey(key: string): Promise<void> {
		const instanceName = this.#tracker.getInstanceByFileKey(key);
		if (!instanceName || !this.registry.hasApp(instanceName)) return;
		const app = this.registry.getApp(instanceName);
		this.logger.logDebug(`Removiendo app: ${app.name}`);
		await app.stop?.();
		await this.registry.cleanupAppModules(instanceName, this.#kernelKey);
		this.registry.deleteApp(app.name);
		this.#tracker.removeByFileKey(key);
		this.#tracker.removeAllByInstance(instanceName);
	}
}
