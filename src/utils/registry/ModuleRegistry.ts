import { IModule, IModuleConfig } from "../../interfaces/modules/IModule.js";
import { IApp } from "../../interfaces/modules/IApp.js";
import { Logger } from "../logger/Logger.js";
import { ILogger } from "../../interfaces/utils/ILogger.js";
import type { IProvider } from "../../providers/BaseProvider.ts";
import type { IUtility } from "../../utilities/BaseUtility.ts";
import type { IService } from "../../services/BaseService.ts";

export type ModuleType = "provider" | "utility" | "service";
export type ModuleTypes = ModuleType | "app";
export type Module = IProvider | IUtility | IService;

export class ModuleRegistry {
	readonly #logger: ILogger = Logger.getLogger("ModuleRegistry");
	readonly #kernelKey: symbol;

	#currentLoadingContext: string | null = null;

	readonly #appsRegistry = new Map<string, IApp>();

	readonly #moduleStore = {
		provider: {
			registry: new Map<string, IModule>(),
			nameMap: new Map<string, string[]>(),
			fileToUniqueKeyMap: new Map<string, string>(),
			refCount: new Map<string, number>(),
		},
		utility: {
			registry: new Map<string, IModule>(),
			nameMap: new Map<string, string[]>(),
			fileToUniqueKeyMap: new Map<string, string>(),
			refCount: new Map<string, number>(),
		},
		service: {
			registry: new Map<string, IModule>(),
			nameMap: new Map<string, string[]>(),
			fileToUniqueKeyMap: new Map<string, string>(),
			refCount: new Map<string, number>(),
		},
	};

	readonly #appModuleDependencies = new Map<string, Set<{ type: ModuleType; uniqueKey: string }>>();

	constructor(kernelKey: symbol) {
		this.#kernelKey = kernelKey;
	}

	get kernelKey(): symbol {
		return this.#kernelKey;
	}

	setLoadingContext(context: string | null): void {
		this.#currentLoadingContext = context;
	}

	getLoadingContext(): string | null {
		return this.#currentLoadingContext;
	}

	#getRegistry(moduleType: ModuleType): Map<string, IModule> {
		return this.#moduleStore[moduleType].registry;
	}

	#getNameMap(moduleType: ModuleType): Map<string, string[]> {
		return this.#moduleStore[moduleType].nameMap;
	}

	#getRefCountMap(moduleType: ModuleType): Map<string, number> {
		return this.#moduleStore[moduleType].refCount;
	}

	getFileToUniqueKeyMap(moduleType: ModuleType): Map<string, string> {
		return this.#moduleStore[moduleType].fileToUniqueKeyMap;
	}

	getUniqueKey(name: string, config?: Record<string, any>): string {
		if (!config || Object.keys(config).length === 0) {
			return name;
		}
		const configStr = JSON.stringify(config);
		let hash = 0;
		for (let i = 0; i < configStr.length; i++) {
			const char = configStr.codePointAt(i) ?? -1;
			hash = (hash << 5) - hash + char;
			hash = hash & hash;
		}
		return `${name}#${Math.abs(hash).toString(16)}`;
	}

	#addModuleToRegistry(
		moduleType: ModuleType,
		name: string,
		uniqueKey: string,
		instance: IModule,
		appName?: string | null,
		silent = false
	): void {
		const registry = this.#getRegistry(moduleType);
		const nameMap = this.#getNameMap(moduleType);
		const refCountMap = this.#getRefCountMap(moduleType);
		const capitalizedModuleType = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);

		const effectiveAppName = appName === undefined ? this.#currentLoadingContext : appName;
		const alreadyExists = registry.has(uniqueKey);

		if (alreadyExists) {
			const currentCount = refCountMap.get(uniqueKey) || 0;
			refCountMap.set(uniqueKey, currentCount + 1);
			if (!silent) {
				this.#logger.logDebug(`${capitalizedModuleType} ${name} reutilizado (Referencias: ${currentCount + 1})`);
			}
		} else {
			registry.set(uniqueKey, instance);
			refCountMap.set(uniqueKey, 1);
		}

		if (!nameMap.has(name)) {
			nameMap.set(name, []);
		}
		const keys = nameMap.get(name)!;
		if (!keys.includes(uniqueKey)) {
			keys.push(uniqueKey);
		}

		if (!alreadyExists && !silent) {
			const uniqueInstances = new Set(keys.map((k) => registry.get(k))).size;
			this.#logger.logOk(`${capitalizedModuleType} registrado: ${name} (Instancias únicas: ${uniqueInstances})`);
		}

		if (effectiveAppName) {
			if (!this.#appModuleDependencies.has(effectiveAppName)) {
				this.#appModuleDependencies.set(effectiveAppName, new Set());
			}
			this.#appModuleDependencies.get(effectiveAppName)!.add({ type: moduleType, uniqueKey });
		}
	}

	#registerModule(moduleType: ModuleType, name: string, instance: IModule, config: IModuleConfig, appName?: string | null): void {
		const configForKey = config.custom || config.config || {};
		const uniqueKey = this.getUniqueKey(name, configForKey);
		this.#addModuleToRegistry(moduleType, name, uniqueKey, instance, appName);
	}

	#getModule<T>(moduleType: ModuleType, name: string, config?: Record<string, any>): T {
		const registry = this.#getRegistry(moduleType);
		const nameMap = this.#getNameMap(moduleType);
		const capitalizedModuleType = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);

		if (config) {
			const uniqueKey = this.getUniqueKey(name, config);
			const instance = registry.get(uniqueKey);
			if (!instance) {
				const errorMessage = `${capitalizedModuleType} ${name} con la configuración especificada no encontrado.`;
				this.#logger.logError(errorMessage);
				throw new Error(errorMessage);
			}
			return instance as T;
		}

		let keys = nameMap.get(name);
		if (!keys || keys.length === 0) {
			const errorMessage = `${capitalizedModuleType} ${name} no encontrado.`;
			this.#logger.logError(errorMessage);
			throw new Error(errorMessage);
		}

		if (keys.length > 1) {
			let filteredKeys = keys;

			if (this.#currentLoadingContext) {
				const appDependencies = this.#appModuleDependencies.get(this.#currentLoadingContext);
				if (appDependencies) {
					const appDependencyKeys = new Set(
						Array.from(appDependencies)
							.filter((dep) => dep.type === moduleType)
							.map((dep) => dep.uniqueKey)
					);
					const matchingKeys = keys.filter((key) => appDependencyKeys.has(key));

					if (matchingKeys.length > 0) {
						filteredKeys = matchingKeys;
					}
				}
			}

			if (filteredKeys.length > 1) {
				const sorted = [...filteredKeys].sort((a, b) => b.length - a.length);
				if (sorted[0].length > sorted[1].length) {
					filteredKeys = [sorted[0]];
				}
			}

			keys = filteredKeys;
		}

		if (keys.length > 1) {
			const errorMessage = `Múltiples instancias de ${capitalizedModuleType} ${name} encontradas. Especifique una configuración para desambiguar.`;
			this.#logger.logError(errorMessage);
			throw new Error(errorMessage);
		}

		return registry.get(keys[0]) as T;
	}

	getProvider<T>(name: string, config?: Record<string, any>): T {
		return this.#getModule("provider", name, config);
	}

	getUtility<T>(name: string, config?: Record<string, any>): T {
		return this.#getModule("utility", name, config);
	}

	getService<T>(name: string, config?: Record<string, any>): T {
		return this.#getModule("service", name, config);
	}

	hasModule(moduleType: ModuleType, name: string, config?: Record<string, any>): boolean {
		const registry = this.#getRegistry(moduleType);
		const uniqueKey = this.getUniqueKey(name, config);
		return registry.has(uniqueKey);
	}

	getApp(name: string): IApp {
		const instance = this.#appsRegistry.get(name);
		if (!instance) {
			this.#logger.logError(`App '${name}' no encontrada.`);
			throw new Error(`App '${name}' no encontrada.`);
		}
		return instance;
	}

	hasApp(name: string): boolean {
		return this.#appsRegistry.has(name);
	}

	registerProvider(name: string, instance: IModule, config: IModuleConfig, appName?: string | null): void {
		this.#registerModule("provider", name, instance, config, appName);
	}

	registerUtility(name: string, instance: IModule, config: IModuleConfig, appName?: string | null): void {
		this.#registerModule("utility", name, instance, config, appName);
	}

	registerService(name: string, instance: IModule, config: IModuleConfig, appName?: string | null): void {
		this.#registerModule("service", name, instance, config, appName);
	}

	registerApp(name: string, instance: IApp): void {
		if (this.#appsRegistry.has(name)) {
			this.#logger.logDebug(`App '${name}' sobrescrita.`);
		}
		this.#appsRegistry.set(name, instance);
		this.#logger.logOk(`App registrada: ${name}`);
	}

	deleteApp(name: string): boolean {
		return this.#appsRegistry.delete(name);
	}

	getAppsRegistry(): Map<string, IApp> {
		return this.#appsRegistry;
	}

	addModuleDependency(moduleType: ModuleType, name: string, config?: Record<string, any>, appName?: string): void {
		const uniqueKey = this.getUniqueKey(name, config);
		const registry = this.#getRegistry(moduleType);
		const refCountMap = this.#getRefCountMap(moduleType);

		if (!registry.has(uniqueKey)) {
			this.#logger.logWarn(`Intentando agregar dependencia de ${moduleType} ${name} que no existe en el registry`);
			return;
		}

		const effectiveAppName = appName || this.#currentLoadingContext;

		if (effectiveAppName) {
			if (!this.#appModuleDependencies.has(effectiveAppName)) {
				this.#appModuleDependencies.set(effectiveAppName, new Set());
			}

			const deps = this.#appModuleDependencies.get(effectiveAppName)!;
			const depExists = Array.from(deps).some((d) => d.type === moduleType && d.uniqueKey === uniqueKey);

			if (!depExists) {
				deps.add({ type: moduleType, uniqueKey });
				const currentCount = refCountMap.get(uniqueKey) || 0;
				refCountMap.set(uniqueKey, currentCount + 1);
				this.#logger.logDebug(`Dependencia agregada: ${moduleType} ${name} para ${effectiveAppName} (Referencias: ${currentCount + 1})`);
			}
		}
	}

	async cleanupAppModules(appName: string, kernelKey: symbol): Promise<void> {
		const dependencies = this.#appModuleDependencies.get(appName);
		if (!dependencies) return;

		for (const { type, uniqueKey } of dependencies) {
			const refCountMap = this.#getRefCountMap(type);
			const currentCount = refCountMap.get(uniqueKey) || 0;

			if (currentCount > 1) {
				refCountMap.set(uniqueKey, currentCount - 1);
				this.#logger.logDebug(`Referencias decrementadas para ${type} ${uniqueKey}: ${currentCount - 1}`);
			} else {
				const registry = this.#getRegistry(type);
				const module = registry.get(uniqueKey);

				if (module) {
					this.#logger.logDebug(`Limpiando ${type}: ${uniqueKey}`);
					await module.stop?.(kernelKey);
					registry.delete(uniqueKey);
					refCountMap.delete(uniqueKey);

					const nameMap = this.#getNameMap(type);
					for (const [name, keys] of nameMap.entries()) {
						const index = keys.indexOf(uniqueKey);
						if (index > -1) {
							keys.splice(index, 1);
							if (keys.length === 0) {
								nameMap.delete(name);
							}
						}
					}
				}
			}
		}

		this.#appModuleDependencies.delete(appName);
	}

	async unloadModule(moduleType: ModuleType, kernelKey: symbol, filePath: string): Promise<void> {
		const fileMap = this.getFileToUniqueKeyMap(moduleType);
		const uniqueKey = fileMap.get(filePath);
		if (uniqueKey) {
			const registry = this.#getRegistry(moduleType);
			const module = registry.get(uniqueKey) as Module;
			if (module) {
				const capitalizedModuleType = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);
				this.#logger.logDebug(`Removiendo ${capitalizedModuleType}: ${module.name}`);
				await module.stop?.(kernelKey);
				registry.delete(uniqueKey);

				const nameMap = this.#getNameMap(moduleType);
				const keys = nameMap.get(module.name);
				if (keys) {
					const index = keys.indexOf(uniqueKey);
					if (index > -1) {
						keys.splice(index, 1);
					}
				}
			}
			fileMap.delete(filePath);
		}
	}

	async stopAllModules(
		kernelKey: symbol,
		withTimeout: <T>(promise: Promise<T>, timeoutMs: number, name: string) => Promise<T | undefined>
	): Promise<void> {
		for (const moduleType of ["provider", "utility", "service"] as ModuleType[]) {
			const capitalizedModuleType = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);
			this.#logger.logInfo(`Deteniendo ${capitalizedModuleType === "Utility" ? "Utilitie" : capitalizedModuleType}s...`);
			const registry = this.#getRegistry(moduleType);
			for (const [key, instance] of registry) {
				try {
					this.#logger.logDebug(`Deteniendo ${capitalizedModuleType} ${key}`);
					if (instance.stop) {
						await withTimeout(instance.stop(kernelKey), 2000, `${capitalizedModuleType} ${key}`);
					}
				} catch (e) {
					this.#logger.logError(`Error deteniendo ${capitalizedModuleType} ${key}: ${e}`);
				}
			}
		}
	}

	getModuleStats(): { providers: number; utilities: number; services: number } {
		return {
			providers: new Set(this.#moduleStore.provider.registry.values()).size,
			utilities: new Set(this.#moduleStore.utility.registry.values()).size,
			services: new Set(this.#moduleStore.service.registry.values()).size,
		};
	}

	getStateSnapshot(): object {
		return {
			apps: Array.from(this.#appsRegistry.keys()),
			providers: {
				keys: Array.from(this.#moduleStore.provider.registry.keys()),
				refs: Object.fromEntries(this.#moduleStore.provider.refCount),
			},
			utilities: {
				keys: Array.from(this.#moduleStore.utility.registry.keys()),
				refs: Object.fromEntries(this.#moduleStore.utility.refCount),
			},
			services: {
				keys: Array.from(this.#moduleStore.service.registry.keys()),
				refs: Object.fromEntries(this.#moduleStore.service.refCount),
			},
			appDependencies: Object.fromEntries(
				Array.from(this.#appModuleDependencies.entries()).map(([appName, deps]) => [
					appName,
					Array.from(deps).map((dep) => ({ type: dep.type, key: dep.uniqueKey })),
				])
			),
		};
	}
}
