import * as path from "node:path";
import { findKernelServices } from "./KernelServiceFinder.js";
import type { Kernel } from "../../kernel.js";
import type { ModuleRegistry } from "../../utils/registry/ModuleRegistry.js";
import type { ModuleLoader } from "../../utils/loaders/ModuleLoader.js";
import type { DockerManager } from "../../utils/system/DockerManager.js";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { DisabledRegistry } from "../orchestration/DisabledRegistry.js";

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
		private readonly isShuttingDown: () => boolean,
		private readonly disabledRegistry: DisabledRegistry
	) {}

	/** Raíces del último `loadAll`, para poder re-encontrar un servicio kernel en runtime. */
	#roots: string[] = [];

	async loadAll(servicesPath: string | string[]): Promise<void> {
		const paths = Array.isArray(servicesPath) ? servicesPath : [servicesPath];
		this.#roots = paths;
		const found = await Promise.all(paths.map((p) => findKernelServices(p)));
		const kernelServices = found.flat().sort((a, b) => a.priority - b.priority);
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

	/**
	 * Re-carga un servicio kernelMode por el MISMO camino que el boot: sin esto, el reload
	 * genérico lo deja sin las caps declaradas ni el pin de plataforma. Devuelve `false` si
	 * `name` no es un servicio kernelMode. No consulta el disabled-set: el orquestador ya
	 * decidió arrancarlo (y durante `enable()` el gate todavía no se levantó).
	 */
	async reload(name: string): Promise<boolean> {
		const found = await Promise.all(this.#roots.map((p) => findKernelServices(p)));
		const svc = found.flat().find((s) => s.name === name);
		if (!svc) return false;
		await this.registry.unloadModulesByName("service", this.kernelKey, name);
		await this.#load(svc);
		return true;
	}

	async #loadOne(svc: KernelServiceEntry): Promise<void> {
		if (this.disabledRegistry.has("service", svc.name)) {
			this.logger.logWarn(`Servicio kernel ${svc.name} deshabilitado (modules-manager): no se levanta.`);
			return;
		}
		try {
			await this.#load(svc);
		} catch (error: any) {
			this.logger.logError(`Error cargando servicio kernel (${svc.name}): ${error.message}`);
		}
	}

	async #load(svc: KernelServiceEntry): Promise<void> {
		const { path: servicePath, name, configPath } = svc;
		await this.#startDocker(servicePath, name);
		const { instance, config } = await this.moduleLoader.loadKernelService(servicePath, configPath, this.kernel, this.kernelKey);
		this.registry.registerService(name, instance, config);
		// Identidad de plataforma atada a la ruta de origen: `name` viene del walk de FS,
		// no del `name` que la clase declara. Es lo que consultan el kernel y el orquestador
		// antes de entregar sus capabilities (ver `ModuleRegistry.getPlatformService`).
		this.registry.pinPlatformService(name, instance, this.kernelKey);
		this.logger.logOk(`Servicio kernel cargado: ${name}`);
	}
}
