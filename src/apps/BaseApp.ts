import * as path from "node:path";
import type { IApp } from "../interfaces/modules/IApp.js";
import { Kernel } from "../kernel.js";
import type { IModuleConfig } from "../interfaces/modules/IModule.js";
import type { UIModuleConfig } from "../interfaces/modules/IUIModule.js";
import type { IUIFederationService } from "@common/types/ui/IUIFederationService.js";
import { BaseModule } from "../common/BaseModule.js";
import { OnlyKernel } from "../utils/decorators/OnlyKernel.ts";
import { mergeAppConfigs, readBaseConfig } from "../core/apps/AppConfigMerger.js";

/**
 * Clase base abstracta para todas las Apps.
 * Maneja la inyección del Kernel y la carga de módulos desde archivos de configuración.
 * Soporta apps UI que se registran automáticamente en IUIFederationService.
 */
export abstract class BaseApp extends BaseModule implements IApp {
	protected readonly appDir: string;
	private uiModuleRegistered = false;
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

	/**
	 * Lógica de inicialización.
	 */
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore - Falso positivo del IDE con decorador legacy (experimentalDecorators: true)
	@OnlyKernel()
	public async start(_kernelKey: symbol): Promise<void> {
		if (!this.config?.uiModule) return; // No es una app UI

		try {
			const uiFederationService = this.getUiFederationService<IUIFederationService>();
			const uiConfig: UIModuleConfig = this.config.uiModule;

			// Si el nombre de la app es "web-ui-library", el nombre del módulo UI debería ser "ui-library"
			const appBaseName = this.name.split(":")[0]; // Remover sufijo de instancia
			const cleanModuleName = uiConfig.name || (appBaseName.startsWith("web-") ? appBaseName.substring(4) : appBaseName);

			uiConfig.name = cleanModuleName;

			this.logger.logInfo(`Registrando módulo UI: ${cleanModuleName}`);
			await uiFederationService.registerUIModule(this.getCapability(), cleanModuleName, this.appDir, uiConfig);
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
	public async stop(_kernelKey: symbol) {
		// Desregistrar módulo UI si estaba registrado
		this.logger.logDebug(`Deteniendo app ${this.name}`);
		if (this.uiModuleRegistered && this.config?.uiModule) {
			try {
				const uiFederation = this.getUiFederationService<IUIFederationService>();
				await uiFederation.unregisterUIModule(this.getCapability(), this.config.uiModule.name);
			} catch (err) {
				this.logger.logDebug("No se pudo desregistrar módulo UI", err);
			}
		}
	}

	async #mergeModuleConfigs(): Promise<void> {
		const baseConfig = await readBaseConfig(this.appDir);
		const instanceConfig: Partial<IModuleConfig> = this.config || {};

		this.config = mergeAppConfigs(baseConfig, instanceConfig);
		Object.freeze(this.config); // Freezes config from modifications
	}

	/**
	 * Carga los módulos de la app después de combinar las configuraciones. Es operación
	 * privilegiada (instancia código, registra módulos): usa la infraCap contenida.
	 * El kernel debe haber provisionado la app (`provisionModule`) antes de llamarla.
	 */
	public async loadModulesFromConfig(): Promise<void> {
		try {
			await this.#mergeModuleConfigs();
			if (this.config) {
				await this.getModuleLoader().loadAllModulesFromDefinition(this.config, this.#kernel);
			}
		} catch (error) {
			this.logger.logError(`Error procesando la configuración de módulos: ${error}`);
			throw error;
		}
	}
}
