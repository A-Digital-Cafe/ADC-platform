import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IApp } from "../interfaces/modules/IApp.js";
import { Kernel } from "../kernel.js";
import type { IModuleConfig } from "../interfaces/modules/IModule.js";
import type { UIModuleConfig } from "../interfaces/modules/IUIModule.js";
import UIFederationService from "../services/core/UIFederationService/index.ts";
import { BaseModule } from "../common/BaseModule.js";
import { OnlyKernel } from "../utils/decorators/OnlyKernel.ts";

/**
 * Clase base abstracta para todas las Apps.
 * Maneja la inyección del Kernel y la carga de módulos desde archivos de configuración.
 * Soporta apps UI que se registran automáticamente en UIFederationService.
 */
export abstract class BaseApp extends BaseModule implements IApp {
	protected readonly appDir: string;
	private uiModuleRegistered = false;
	private kernelKey?: symbol;
	readonly #kernel: Kernel;

	constructor(
		kernel: Kernel,
		public readonly name: string = "",
		config?: IModuleConfig,
		_appFilePath?: string
	) {
		super(kernel, config);
		this.#kernel = kernel;
		if (_appFilePath) {
			this.appDir = path.dirname(_appFilePath);
		} else {
			// Fallback para cuando no se proporciona la ruta (aunque debería hacerse siempre)
			const appDirName = this.name.split(":")[0];
			const isDevelopment = process.env.NODE_ENV === "development";
			this.appDir = isDevelopment
				? path.resolve(process.cwd(), "src", "apps", appDirName)
				: path.resolve(process.cwd(), "dist", "apps", appDirName);
		}
	}

	public readonly setKernelKey = (key: symbol): void => {
		if (this.kernelKey) {
			throw new Error("Kernel key ya está establecida");
		}
		this.kernelKey = key;
	};

	/**
	 * Lógica de inicialización.
	 */
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore - Falso positivo del IDE con decorador legacy (experimentalDecorators: true)
	@OnlyKernel()
	public async start(_kernelKey: symbol): Promise<void> {
		if (!this.config?.uiModule) return; // No es una app UI

		try {
			const uiFederationService = this.#kernel.registry.getService<UIFederationService>("UIFederationService");
			const uiConfig: UIModuleConfig = this.config.uiModule;

			// Si el nombre de la app es "web-ui-library", el nombre del módulo UI debería ser "ui-library"
			const appBaseName = this.name.split(":")[0]; // Remover sufijo de instancia
			const cleanModuleName = uiConfig.name || (appBaseName.startsWith("web-") ? appBaseName.substring(4) : appBaseName);

			uiConfig.name = cleanModuleName;

			this.logger.logInfo(`Registrando módulo UI: ${cleanModuleName}`);
			await uiFederationService.registerUIModule(cleanModuleName, this.appDir, uiConfig);
			this.uiModuleRegistered = true;

			this.logger.logOk(`Módulo UI ${cleanModuleName} registrado exitosamente`);
		} catch (error: any) {
			this.logger.logWarn(`No se pudo registrar como módulo UI: ${error.message}`);
		}
	}

	/** La lógica de negocio de la app. */
	abstract run(): Promise<void>;

	/** Lógica de detención. */
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore - Falso positivo del IDE con decorador legacy (experimentalDecorators: true)
	@OnlyKernel()
	public async stop() {
		// Desregistrar módulo UI si estaba registrado
		this.logger.logDebug(`Deteniendo app ${this.name}`);
		if (this.uiModuleRegistered && this.config?.uiModule) {
			try {
				const uiFederation = this.#kernel.registry.getService<UIFederationService>("UIFederationService");
				await uiFederation.unregisterUIModule(this.config.uiModule.name);
			} catch (err) {
				this.logger.logDebug("No se pudo desregistrar módulo UI", err);
			}
		}
	}

	async #mergeModuleConfigs(): Promise<void> {
		const appDir = this.appDir;

		let baseConfig: Partial<IModuleConfig> = {};
		try {
			const defaultConfigPath = path.join(appDir, "default.json");
			const content = await fs.readFile(defaultConfigPath, "utf-8");
			baseConfig = JSON.parse(content);
		} catch {
			// NOOP
		}

		const instanceConfig: Partial<IModuleConfig> = this.config || {};

		// Función auxiliar para fusionar módulos por nombre
		const mergeModules = (base: IModuleConfig[] = [], instance: IModuleConfig[] = []): IModuleConfig[] => {
			const byName = new Map(base.map((item) => [item.name, item]));
			for (const item of instance) {
				const existing = byName.get(item.name) || {};
				byName.set(item.name, { ...existing, ...item });
			}
			return Array.from(byName.values());
		};

		const mergedProviders = mergeModules(baseConfig.providers, instanceConfig.providers);
		const mergedUtilities = mergeModules(baseConfig.utilities, instanceConfig.utilities);
		const mergedServices = mergeModules(baseConfig.services, instanceConfig.services);

		// Los servicios SIN providers propios heredan los globales
		// Esto permite que usen la configuración correcta del provider global
		const servicesWithInheritedProviders = mergedServices.map((service: IModuleConfig) => {
			if (!service.providers || service.providers.length === 0) {
				return { ...service, providers: mergedProviders };
			}
			return service;
		});

		const mergedConfig: Partial<IModuleConfig> = {
			...baseConfig,
			...instanceConfig,
			failOnError: instanceConfig.failOnError ?? baseConfig.failOnError,
			providers: mergedProviders,
			utilities: mergedUtilities,
			services: servicesWithInheritedProviders,
		};

		this.config = mergedConfig as IModuleConfig;
		Object.freeze(this.config); // Freezes config from modifications
	}

	/** Carga los módulos de la app después de combinar las configuraciones. */
	public async loadModulesFromConfig(): Promise<void> {
		try {
			await this.#mergeModuleConfigs();
			if (this.config) {
				await Kernel.moduleLoader.loadAllModulesFromDefinition(this.config, this.#kernel);
			}
		} catch (error) {
			this.logger.logError(`Error procesando la configuración de módulos: ${error}`);
			throw error;
		}
	}
}
