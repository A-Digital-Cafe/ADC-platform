import * as path from "node:path";
import type { Kernel } from "../../kernel.js";
import type { ModuleRegistry, ModuleType, Module } from "../../utils/registry/ModuleRegistry.js";
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

	async registerByPath(moduleType: ModuleType, filePath: string): Promise<void> {
		if (this.isShuttingDown()) {
			this.logger.logDebug(`Cierre en progreso, ignorando carga de ${moduleType}: ${filePath}`);
			return;
		}
		try {
			const modulePath = path.dirname(filePath);
			let config = this.moduleLoader.getConfigByPath(modulePath);
			config ??= { name: path.basename(modulePath) };

			const module = await this.register(moduleType, config);
			const uniqueKey = this.registry.getUniqueKey(module.name, config.custom);
			this.registry.getFileToUniqueKeyMap(moduleType).set(filePath, uniqueKey);
		} catch (e) {
			const cap = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);
			this.logger.logError(`Error cargando ${cap} ${filePath}: ${e}`);
		}
	}
}
