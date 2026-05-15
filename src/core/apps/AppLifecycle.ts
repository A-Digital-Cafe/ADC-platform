import * as path from "node:path";
import type { IApp } from "../../interfaces/modules/IApp.js";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { ModuleRegistry } from "../../utils/registry/ModuleRegistry.js";
import type { AppInstanceTracker } from "./AppInstanceTracker.js";

const RETRY_RUN_MS = 30_000;

export interface AppLifecycleDeps {
	registry: ModuleRegistry;
	tracker: AppInstanceTracker;
	logger: ILogger;
	kernelKey: symbol;
	isShuttingDown: () => boolean;
}

export class AppLifecycle {
	constructor(private readonly deps: AppLifecycleDeps) {}

	initializeAndRunApp = async (app: IApp, filePath: string, instanceName: string, configPath?: string): Promise<void> => {
		const { logger, registry, tracker, kernelKey, isShuttingDown } = this.deps;
		if (isShuttingDown()) {
			logger.logDebug(`Cierre en progreso, no se inicializa app: ${instanceName}`);
			return;
		}
		logger.logInfo(`Inicializando App: ${instanceName} desde ${path.basename(filePath)}`);
		registry.registerApp(instanceName, app);
		logger.logDebug(`Inicializando App ${app.name}`);

		registry.setLoadingContext(instanceName);
		try {
			await app.loadModulesFromConfig();
			app.setKernelKey(kernelKey);
			await app.start?.(kernelKey);
		} finally {
			registry.setLoadingContext(null);
		}

		if (isShuttingDown()) {
			logger.logDebug(`Cierre en progreso, no se ejecuta run() para: ${instanceName}`);
			return;
		}

		tracker.registerInstance(filePath, instanceName, configPath);
		logger.logDebug(`Ejecutando App ${app.name}`);
		app.run().catch((e: Error) => {
			if (isShuttingDown()) return;
			logger.logError(`Error ejecutando App ${app.name}: {}\nSe intentará ejecutarla de nuevo en 30 segundos...`, e.message);
			setTimeout(() => this.initializeAndRunApp(app, filePath, instanceName, configPath), RETRY_RUN_MS);
		});
	};

	async stopAndCleanupInstance(instanceName: string): Promise<void> {
		const { registry, tracker, logger, kernelKey } = this.deps;
		if (!registry.hasApp(instanceName)) return;
		const app = registry.getApp(instanceName);
		logger.logInfo(`Recargando instancia de App: ${instanceName}`);
		await app.stop?.();
		await registry.cleanupAppModules(instanceName, kernelKey);
		registry.deleteApp(instanceName);
		tracker.removeFileKeysByInstance(instanceName);
	}
}
