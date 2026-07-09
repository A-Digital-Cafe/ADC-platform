import * as fs from "node:fs/promises";
import * as path from "node:path";
import { IModuleLoader } from "../../../interfaces/modules/IModuleLoader.js";
import { IModuleConfig } from "../../../interfaces/modules/IModule.js";
import type { BaseProvider, IProvider } from "../../../providers/BaseProvider.ts";
import type { BaseUtility, IUtility } from "../../../utilities/BaseUtility.ts";
import type { BaseService, IService } from "../../../services/BaseService.ts";

import { Kernel } from "../../../kernel.js";
import { Logger } from "../../logger/Logger.js";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { moduleConfigCheck } from "@common/schemas/module-config.ts";

type Constructor<T> = new (...args: any[]) => T;

export default class TypeScriptLoader implements IModuleLoader {
	readonly #extension = process.env.NODE_ENV === "development" ? ".ts" : ".js";

	readonly #kernelKey: symbol;

	constructor(kernelKey: symbol) {
		this.#kernelKey = kernelKey;
	}

	async canHandle(modulePath: string): Promise<boolean> {
		try {
			await fs.stat(path.join(modulePath, `index${this.#extension}`));
			return true;
		} catch {
			return false;
		}
	}

	async loadProvider(modulePath: string, config?: Record<string, any>): Promise<IProvider> {
		const ProviderClass = await this.importClass<BaseProvider>(modulePath, "Provider");
		const providerInstance = new ProviderClass(this.enrichConfig(modulePath, config));
		try {
			// Token de ciclo de vida ÚNICO por instancia (NO la master key): un provider
			// comprometido no puede usar `Kernel.getModuleLoader(token)` ni otros gates con él.
			const lifecycleToken = Symbol(`lifecycle:${providerInstance.name}`);
			providerInstance.setKernelKey(lifecycleToken);
			await providerInstance.start(lifecycleToken);
		} catch (error: any) {
			Logger.warn(`[TypeScriptLoader] Error iniciando provider ${providerInstance.name}: ${error.message}`);
		}
		return providerInstance;
	}

	async loadUtility(modulePath: string, config?: Record<string, any>): Promise<IUtility> {
		const UtilityClass = await this.importClass<IUtility>(modulePath, "Utility");
		const utilityInstance = new UtilityClass(this.enrichConfig(modulePath, config));
		try {
			// Token de ciclo de vida ÚNICO por instancia (NO la master key).
			const lifecycleToken = Symbol(`lifecycle:${utilityInstance.name}`);
			(utilityInstance as BaseUtility).setKernelKey?.(lifecycleToken);
			await utilityInstance.start?.(lifecycleToken);
		} catch (error: any) {
			Logger.warn(`[TypeScriptLoader] Error iniciando utility ${utilityInstance.name}: ${error.message}`);
		}
		return utilityInstance;
	}

	async loadService(modulePath: string, kernel: Kernel, config?: Record<string, any> | IModuleConfig): Promise<IService> {
		const ServiceClass = await this.importClass<BaseService>(modulePath, "Service");
		// Service recibe argumentos distintos (kernel + config), por lo que lo instanciamos diferente
		const serviceInstance = new ServiceClass(kernel, config);
		try {
			// Privilegios declarados en el config.json del servicio (para los scopes de su businessCap).
			let declared: string[] | undefined;
			try {
				const raw = safeParseJson(await fs.readFile(path.join(modulePath, "config.json"), "utf-8"), moduleConfigCheck);
				if (raw && Array.isArray(raw.privileges)) declared = raw.privileges;
			} catch {
				/* sin config.json o sin privileges */
			}
			const lifecycleToken = kernel.provisionModule(this.#kernelKey, serviceInstance, { name: serviceInstance.name, kind: "service", path: modulePath, declared });
			await serviceInstance.start(lifecycleToken);
		} catch (error: any) {
			Logger.warn(`[TypeScriptLoader] Error iniciando service ${serviceInstance.name}: ${error.message}`);
		}
		return serviceInstance;
	}

	/**
	 * Helper centralizado para importar módulos dinámicamente y validar su estructura.
	 */
	private async importClass<T>(modulePath: string, role: string): Promise<Constructor<T>> {
		try {
			const indexFile = path.join(modulePath, `index${this.#extension}`);
			// Cache busting para recarga en caliente
			const module = await import(`${indexFile}?v=${Date.now()}`);
			const ModuleClass = module.default;

			if (!ModuleClass) {
				throw new Error(`El módulo ${indexFile} no tiene un export default.`);
			}

			return ModuleClass as Constructor<T>;
		} catch (error) {
			Logger.error(`[TypeScriptLoader] Error cargando ${role}: ${error}`);
			throw error;
		}
	}

	/**
	 * Normaliza la configuración inyectando metadatos del módulo.
	 */
	private enrichConfig(modulePath: string, config?: Record<string, any>): Record<string, any> {
		return {
			...config,
			moduleName: config?.moduleName || path.basename(modulePath),
			moduleVersion: config?.moduleVersion || "latest",
			language: config?.language || "typescript",
		};
	}
}
