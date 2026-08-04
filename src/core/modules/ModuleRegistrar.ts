import * as path from "node:path";
import type { Kernel } from "../../kernel.js";
import { moduleKeyConfig, type ModuleRegistry, type ModuleType, type Module } from "../../utils/registry/ModuleRegistry.js";
import type { ModuleLoader } from "../../utils/loaders/ModuleLoader.js";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { IModuleConfig } from "../../interfaces/modules/IModule.js";
import type { BaseProvider } from "../../providers/BaseProvider.js";
import type { IUtility } from "../../utilities/BaseUtility.js";
import type { BaseService } from "../../services/BaseService.js";

export class ModuleRegistrar {
	constructor(
		private readonly kernel: Kernel,
		private readonly registry: ModuleRegistry,
		private readonly moduleLoader: ModuleLoader,
		private readonly logger: ILogger,
		private readonly isShuttingDown: () => boolean
	) {}

	async register(moduleType: ModuleType, config: IModuleConfig): Promise<Module> {
		switch (moduleType) {
			case "provider": {
				const m: BaseProvider = await this.moduleLoader.loadProvider(config);
				this.registry.registerProvider(m.name, m, config);
				return m;
			}
			case "utility": {
				const m: IUtility = await this.moduleLoader.loadUtility(config);
				this.registry.registerUtility(m.name, m, config);
				return m;
			}
			case "service": {
				const m: BaseService = await this.moduleLoader.loadService(config, this.kernel);
				this.registry.registerService(m.name, m, config);
				return m;
			}
		}
	}

	async registerByPath(moduleType: ModuleType, filePath: string): Promise<Module | undefined> {
		if (this.isShuttingDown()) {
			this.logger.logDebug(`Cierre en progreso, ignorando carga de ${moduleType}: ${filePath}`);
			return undefined;
		}
		try {
			const modulePath = path.dirname(filePath);
			let config = this.moduleLoader.getConfigByPath(modulePath);
			config ??= { name: path.basename(modulePath) };

			const module = await this.register(moduleType, config);
			// Misma derivación que usa el registro (`moduleKeyConfig`): si difieren, el
			// fileToUniqueKeyMap apunta a una key que no existe y el hot-reload por archivo
			// deja de encontrar el módulo que tiene que reemplazar.
			const uniqueKey = this.registry.getUniqueKey(module.name, moduleKeyConfig(config));
			this.registry.getFileToUniqueKeyMap(moduleType).set(filePath, uniqueKey);
			return module;
		} catch (e) {
			const cap = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);
			this.logger.logError(`Error cargando ${cap} ${filePath}: ${e}`);
			return undefined;
		}
	}
}
