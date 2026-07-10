import * as path from "node:path";
import { IModule, IModuleConfig } from "../interfaces/modules/IModule.js";
import * as fs from "node:fs/promises";
import { Kernel } from "../kernel.js";
import type { ModuleLoader } from "../utils/loaders/ModuleLoader.js";
import type { ModuleRegistry } from "../utils/registry/ModuleRegistry.js";
import { ILifecycle } from "../interfaces/behaviours/ILifecycle.js";
import { OnlyKernel } from "../utils/decorators/OnlyKernel.ts";
import { BaseModule } from "../common/BaseModule.js";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { moduleConfigCheck } from "@common/schemas/module-config.ts";

export interface IService extends IModule, ILifecycle {}

/**
 * Clase base abstracta para todos los Services.
 * Maneja la inyección del Kernel y la carga de módulos desde config.json.
 */
export abstract class BaseService extends BaseModule implements IService {
	private isInitialized = false; // Flag para prevenir múltiples inicializaciones
	/** Nombre único del service */
	abstract readonly name: string;

	constructor(
		kernel: Kernel,
		protected readonly options?: IModuleConfig
	) {
		super(kernel, options);
	}

	/**
	 * Lógica de inicialización del service
	 */
	@OnlyKernel()
	public async start(_kernelKey: symbol): Promise<void> {
		// Prevenir múltiples inicializaciones
		if (this.isInitialized) {
			this.logger.logDebug(`${this.name} ya está inicializado, saltando start()`);
			return;
		}

		// Acceso privilegiado (carga + registro de sub‑dependencias) vía la infraCap contenida.
		const registry = this.getMutableRegistry();
		const moduleLoader = this.getModuleLoader();

		// Si ModuleLoader pasó el path real, usarlo; si no, calcular manualmente
		const serviceDir = this.options?.__modulePath || this.getServiceDir();
		const modulesConfigPath = path.join(serviceDir, "config.json");
		const envPath = path.join(serviceDir, ".env");

		this.logger.logInfo(`Inicializando ${this.name}...`);

		try {
			// Cargar variables de entorno del servicio usando ModuleLoader
			const serviceEnvVars = await moduleLoader.loadEnvFile(envPath);
			const baseConfig = await this.#readBaseConfig(moduleLoader, modulesConfigPath, serviceEnvVars);
			const providersToUse = await this.#resolveProviders(moduleLoader, registry, baseConfig, serviceEnvVars);

			// Utilities: prioridad app (options) > config.json del servicio.
			// Son globales (no limitadas a una app específica).
			const utilitiesToLoad = this.options?.utilities || baseConfig.utilities || [];
			await this.#loadUtilities(moduleLoader, registry, utilitiesToLoad, baseConfig.failOnError);

			this.config = {
				name: this.name,
				...baseConfig,
				...this.options, // options tiene prioridad
				providers: providersToUse,
				utilities: utilitiesToLoad,
				services: this.options?.services || baseConfig.services || [],
			};

			// Marcar como inicializado
			this.isInitialized = true;

			this.logger.logOk(`Inicialización base completada`);
		} catch (error) {
			this.logger.logError(`Error durante inicialización: ${error}`);
			throw error;
		}
	}

	/** Lee e interpola el config.json del servicio (objeto vacío si no existe o no parsea). */
	async #readBaseConfig(
		moduleLoader: ModuleLoader,
		modulesConfigPath: string,
		serviceEnvVars: Record<string, string>
	): Promise<Partial<IModuleConfig>> {
		try {
			const configContent = await fs.readFile(modulesConfigPath, "utf-8");
			const rawConfig = safeParseJson(configContent, moduleConfigCheck);
			if (rawConfig) return moduleLoader.interpolateEnvVars(rawConfig, serviceEnvVars);
		} catch (e: any) {
			this.logger.logDebug(`No se pudo leer config.json: ${e.message}`);
		}
		return {};
	}

	/**
	 * Providers efectivos del servicio: si la app los proporciona (options),
	 * se usan esos (ya cargados); si no, se cargan los del config.json propio.
	 */
	async #resolveProviders(
		moduleLoader: ModuleLoader,
		registry: ModuleRegistry,
		baseConfig: Partial<IModuleConfig>,
		serviceEnvVars: Record<string, string>
	): Promise<IModuleConfig["providers"]> {
		const fromApp = this.options?.providers || [];
		if (fromApp.length > 0) return fromApp;
		if (!baseConfig.providers || !Array.isArray(baseConfig.providers)) return fromApp;

		// Cargar los providers del config.json con las variables de entorno del servicio
		for (const providerConfig of baseConfig.providers) {
			try {
				const provider = await moduleLoader.loadProvider(providerConfig, serviceEnvVars);
				registry.registerProvider(provider.name, provider, providerConfig);
				// También registrar por el nombre del módulo/configuración
				if (providerConfig.name !== provider.name) {
					registry.registerProvider(providerConfig.name, provider, providerConfig);
				}
				// Agregar como dependencia de la app actual
				registry.addModuleDependency("provider", providerConfig.name, providerConfig.custom);
			} catch (error) {
				const message = `Error cargando provider ${providerConfig.name}`;
				// failOnError puede venir del config.json del servicio
				if (baseConfig.failOnError) throw new Error(message, { cause: error });
				this.logger.logWarn(message);
			}
		}
		return baseConfig.providers;
	}

	/** Carga y registra las utilities del servicio (con alias por nombre base si contiene "/"). */
	async #loadUtilities(
		moduleLoader: ModuleLoader,
		registry: ModuleRegistry,
		utilitiesToLoad: IModuleConfig["utilities"],
		failOnError: boolean | undefined
	): Promise<void> {
		if (!utilitiesToLoad || !Array.isArray(utilitiesToLoad)) return;
		for (const utilityConfig of utilitiesToLoad) {
			try {
				const utility = await moduleLoader.loadUtility(utilityConfig);
				registry.registerUtility(utility.name, utility, utilityConfig, null);
				// Si el nombre contiene "/", también registrar con el nombre base como alias
				if (utilityConfig.name.includes("/")) {
					const baseName = utilityConfig.name.split("/").pop()!;
					registry.registerUtility(baseName, utility, utilityConfig, null);
				}
			} catch (error: any) {
				const message = `Error cargando utility ${utilityConfig.name}: ${error.message}`;
				this.logger.logError(message);
				if (failOnError) throw new Error(message, { cause: error });
				else throw error; // Re-lanzar para que el servicio no se registre
			}
		}
	}

	/**
	 * Lógica de cierre del service
	 */
	@OnlyKernel()
	public async stop(_kernelKey: symbol): Promise<void> {
		this.logger.logDebug(`Deteniendo servicio ${this.name}`);
	}

	/**
	 * Resuelve el directorio del service según el entorno
	 */
	protected getServiceDir(): string {
		const isDevelopment = process.env.NODE_ENV === "development";
		const serviceName = this.constructor.name
			.replace(/Service$/, "")
			.replaceAll(/([A-Z])/g, "-$1")
			.toLowerCase()
			.replace(/^-/, "");

		const serviceDir = isDevelopment
			? path.resolve(process.cwd(), "src", "services", serviceName)
			: path.resolve(process.cwd(), "dist", "services", serviceName);

		return serviceDir;
	}
}
