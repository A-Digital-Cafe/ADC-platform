import * as path from "node:path";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { ModuleRegistry, ModuleType } from "../../utils/registry/ModuleRegistry.js";
import type { ModuleRegistrar } from "./ModuleRegistrar.js";
import type { AppLoader } from "../apps/AppLoader.js";

/**
 * Coordina la recarga de un módulo (provider/utility/service) y propaga el
 * reload a todas las apps que dependen de él, manteniendo la cadena DI viva.
 */
export class DependencyReloader {
	constructor(
		private readonly registry: ModuleRegistry,
		private readonly registrar: ModuleRegistrar,
		private readonly appLoader: AppLoader,
		private readonly logger: ILogger,
		private readonly kernelKey: symbol
	) {}

	/**
	 * Recarga un módulo a partir del cambio en su archivo (watcher de desarrollo).
	 * 1) Captura nombres y apps dependientes ANTES de descargar.
	 * 2) Descarga el módulo.
	 * 3) Vuelve a cargarlo desde su filePath.
	 * 4) Recarga las apps dependientes (en paralelo) para que reciban la nueva instancia.
	 */
	handleFileChange = async (moduleType: ModuleType, filePath: string): Promise<void> => {
		try {
			const dependents = this.#collectDependentsByFile(moduleType, filePath);
			await this.registry.unloadModule(moduleType, this.kernelKey, filePath);
			await this.registrar.registerByPath(moduleType, filePath);
			await this.#reloadApps(dependents, `${moduleType}@${path.basename(path.dirname(filePath))}`);
		} catch (error: any) {
			this.logger.logError(`Error recargando ${moduleType} desde ${filePath}: ${error.message ?? error}`);
		}
	};

	/**
	 * Recarga un módulo por nombre (y versión opcional). Pensado para invocarse
	 * desde código autorizado vía kernel.reloadModule(kernelKey, ...).
	 * Descarga TODAS las instancias con ese nombre, recarga la versión solicitada
	 * y refresca las apps dependientes.
	 */
	reloadByName = async (moduleType: ModuleType, name: string, version: string = "latest", language: string = "typescript"): Promise<void> => {
		const dependents = this.registry.getDependentAppNamesByModuleName(moduleType, name);
		await this.registry.unloadModulesByName(moduleType, this.kernelKey, name);
		await this.registrar.register(moduleType, { name, version, language });
		this.logger.logOk(`${moduleType} '${name}' (${version}) recargado.`);
		await this.#reloadApps(dependents, `${moduleType}:${name}@${version}`);
	};

	#collectDependentsByFile(moduleType: ModuleType, filePath: string): string[] {
		const uniqueKey = this.registry.getFileToUniqueKeyMap(moduleType).get(filePath);
		if (!uniqueKey) return [];
		return this.registry.getDependentAppNames(moduleType, uniqueKey);
	}

	async #reloadApps(appInstanceNames: string[], reason: string): Promise<void> {
		if (appInstanceNames.length === 0) return;
		this.logger.logInfo(`Cascada: recargando ${appInstanceNames.length} app(s) por cambio en ${reason}`);
		await Promise.all(
			appInstanceNames.map((name) =>
				this.appLoader.reloadAppByInstanceName(name).catch((e) => {
					this.logger.logError(`Error recargando app ${name} en cascada: ${e}`);
				})
			)
		);
	}
}
