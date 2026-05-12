import * as path from "node:path";
import { IModule, IModuleConfig } from "../interfaces/modules/IModule.js";
import * as fs from "node:fs/promises";
import { Kernel } from "../kernel.js";
import { ILifecycle } from "../interfaces/behaviours/ILifecycle.js";
import { OnlyKernel } from "../utils/decorators/OnlyKernel.ts";
import { BaseModule } from "../common/BaseModule.js";

export interface IService extends IModule, ILifecycle {}

/**
 * Clase base abstracta para todos los Services.
 * Maneja la inyección del Kernel y la carga de módulos desde config.json.
 */
export abstract class BaseService extends BaseModule implements IService {
	private kernelKey?: symbol;
	private isInitialized = false; // Flag para prevenir múltiples inicializaciones
	/** Nombre único del service */
	abstract readonly name: string;

	readonly #kernel: Kernel;

	constructor(
		kernel: Kernel,
		protected readonly options?: IModuleConfig
	) {
		super(kernel, options);
		this.#kernel = kernel;
	}

	public readonly setKernelKey = (key: symbol): void => {
		if (this.kernelKey) {
			throw new Error("Kernel key ya está establecida");
		}
		this.kernelKey = key;
	};

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

		// Si ModuleLoader pasó el path real, usarlo; si no, calcular manualmente
		const serviceDir = this.options?.__modulePath || this.getServiceDir();
		const modulesConfigPath = path.join(serviceDir, "config.json");
		const envPath = path.join(serviceDir, ".env");

		this.logger.logInfo(`Inicializando ${this.name}...`);

		try {
			// Cargar variables de entorno del servicio usando ModuleLoader
			const serviceEnvVars = await Kernel.moduleLoader.loadEnvFile(envPath);

			let baseConfig: Partial<IModuleConfig> = {};
			try {
				const configContent = await fs.readFile(modulesConfigPath, "utf-8");
				const rawConfig = JSON.parse(configContent);
				baseConfig = Kernel.moduleLoader.interpolateEnvVars(rawConfig, serviceEnvVars);
			} catch (e: any) {
				this.logger.logDebug(`No se pudo leer config.json: ${e.message}`);
			}

			// Determinar qué providers usar:
			// - Si la app proporciona providers (options.providers), usar esos
			// - Si no, cargar los del config.json del servicio
			let providersToUse = this.options?.providers || [];

			if (!providersToUse || providersToUse.length === 0) {
				// No hay providers de la app, usar los del config.json del servicio
				if (baseConfig.providers && Array.isArray(baseConfig.providers)) {
					providersToUse = baseConfig.providers;

					// Cargar estos providers con las variables de entorno del servicio
					for (const providerConfig of baseConfig.providers) {
						try {
							const provider = await Kernel.moduleLoader.loadProvider(providerConfig, serviceEnvVars);
							this.#kernel.registry.registerProvider(provider.name, provider, providerConfig);

							// También registrar por el nombre del módulo/configuración
							if (providerConfig.name !== provider.name) {
								this.#kernel.registry.registerProvider(providerConfig.name, provider, providerConfig);
							}

							// Agregar como dependencia de la app actual
							this.#kernel.registry.addModuleDependency("provider", providerConfig.name, providerConfig.custom);
						} catch (error) {
							const message = `Error cargando provider ${providerConfig.name}`;
							// failOnError puede venir del config.json del servicio
							if (baseConfig.failOnError) throw new Error(message, { cause: error });
							this.logger.logWarn(message);
						}
					}
				}
			}

			// Cargar las utilities del servicio
			// Prioridad: utilities de la app (options) > utilities del config.json del servicio
			// Estas utilities son globales (no limitadas a una app específica)
			const utilitiesToLoad = this.options?.utilities || baseConfig.utilities || [];

			if (utilitiesToLoad && Array.isArray(utilitiesToLoad)) {
				for (const utilityConfig of utilitiesToLoad) {
					try {
						const utility = await Kernel.moduleLoader.loadUtility(utilityConfig);
						this.#kernel.registry.registerUtility(utility.name, utility, utilityConfig, null);

						// Si el nombre contiene "/", también registrar con el nombre base como alias
						if (utilityConfig.name.includes("/")) {
							const baseName = utilityConfig.name.split("/").pop()!;
							this.#kernel.registry.registerUtility(baseName, utility, utilityConfig, null);
						}
					} catch (error: any) {
						const message = `Error cargando utility ${utilityConfig.name}: ${error.message}`;
						this.logger.logError(message);
						if (baseConfig.failOnError) throw new Error(message, { cause: error });
						else throw error; // Re-lanzar para que el servicio no se registre
					}
				}
			}

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
