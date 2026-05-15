import * as path from "node:path";
import type { IApp } from "../../interfaces/modules/IApp.js";
import type { Kernel } from "../../kernel.js";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import { FILE_EXT, readJson, type AppCtor } from "./AppFileUtils.js";
import type { AppInstanceTracker } from "./AppInstanceTracker.js";
import type { AppLifecycle } from "./AppLifecycle.js";

export interface AppReloaderDeps {
	kernel: Kernel;
	tracker: AppInstanceTracker;
	lifecycle: AppLifecycle;
	logger: ILogger;
}

export class AppReloader {
	constructor(private readonly deps: AppReloaderDeps) {}

	reloadAppByInstanceName = async (instanceName: string): Promise<void> => {
		const configPath = this.deps.tracker.findConfigPathByInstance(instanceName);
		if (!configPath) {
			this.deps.logger.logWarn(`No se encontró configPath para la instancia: ${instanceName}`);
			return;
		}
		await this.reloadAppInstance(configPath);
	};

	reloadAppInstance = async (configPath: string): Promise<void> => {
		const { tracker, lifecycle, logger, kernel } = this.deps;
		try {
			const instanceName = tracker.getInstanceByConfigPath(configPath);
			if (!instanceName) {
				logger.logWarn(`No se encontró instancia para el archivo de configuración: ${configPath}`);
				return;
			}
			await lifecycle.stopAndCleanupInstance(instanceName);

			const appDir = configPath.includes(`${path.sep}configs${path.sep}`)
				? path.dirname(path.dirname(configPath))
				: path.dirname(configPath);
			const appFilePath = path.join(appDir, `index${FILE_EXT}`);

			const module = await import(`${appFilePath}?v=${Date.now()}`);
			const AppClass: AppCtor | undefined = module.default;
			if (!AppClass) {
				logger.logError(`No se pudo cargar la clase de la app: ${instanceName.split(":")[0]}`);
				return;
			}

			const config = await readJson(configPath);
			if (!config) return;

			const newApp: IApp = new AppClass(kernel, instanceName, config, appFilePath);
			await lifecycle.initializeAndRunApp(newApp, appFilePath, instanceName, configPath);
			logger.logOk(`Instancia recargada exitosamente: ${instanceName}`);
		} catch (error) {
			logger.logError(`Error recargando instancia desde ${configPath}: ${error}`);
		}
	};
}
