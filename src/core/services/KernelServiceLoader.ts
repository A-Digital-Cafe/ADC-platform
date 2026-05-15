import * as path from "node:path";
import { findKernelServices } from "./KernelServiceFinder.js";
import type { Kernel } from "../../kernel.js";
import type { ModuleRegistry } from "../../utils/registry/ModuleRegistry.js";
import type { ModuleLoader } from "../../utils/loaders/ModuleLoader.js";
import type { DockerManager } from "../../utils/system/DockerManager.js";
import type { ILogger } from "../../interfaces/utils/ILogger.js";

interface KernelServiceEntry {
	path: string;
	name: string;
	configPath: string;
}

export class KernelServiceLoader {
	constructor(
		private readonly kernel: Kernel,
		private readonly registry: ModuleRegistry,
		private readonly moduleLoader: ModuleLoader,
		private readonly dockerManager: DockerManager,
		private readonly logger: ILogger,
		private readonly kernelKey: symbol,
		private readonly isShuttingDown: () => boolean
	) {}

	async loadAll(servicesPath: string): Promise<void> {
		const kernelServices = await findKernelServices(servicesPath);
		if (kernelServices.length === 0) return;

		this.logger.logInfo(`Cargando ${kernelServices.length} servicio(s) en modo kernel...`);
		for (const svc of kernelServices) {
			if (this.isShuttingDown()) {
				this.logger.logInfo("Cierre en progreso, abortando carga de servicios kernel...");
				return;
			}
			await this.#loadOne(svc);
		}
	}

	async #startDocker(servicePath: string, name: string): Promise<void> {
		try {
			await this.dockerManager.startServiceDockerCompose(path.dirname(servicePath), name);
		} catch {
			this.logger.logDebug(`docker-compose no disponible para ${name}`);
		}
	}

	async #loadOne(svc: KernelServiceEntry): Promise<void> {
		const { path: servicePath, name, configPath } = svc;
		try {
			await this.#startDocker(servicePath, name);
			const { instance, config } = await this.moduleLoader.loadKernelService(servicePath, configPath, this.kernel, this.kernelKey);
			this.registry.registerService(name, instance, config);
			this.logger.logOk(`Servicio kernel cargado: ${name}`);
		} catch (error: any) {
			this.logger.logError(`Error cargando servicio kernel (${name}): ${error.message}`);
		}
	}
}
