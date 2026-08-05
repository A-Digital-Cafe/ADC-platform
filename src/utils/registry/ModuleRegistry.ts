import { AsyncLocalStorage } from "node:async_hooks";
import { IModule, IModuleConfig } from "../../interfaces/modules/IModule.js";
import { IApp } from "../../interfaces/modules/IApp.js";
import { stopBoundModule } from "../decorators/OnlyKernel.ts";
import { VersionResolver } from "../VersionResolver.js";
import { Logger } from "../logger/Logger.js";
import { ILogger } from "../../interfaces/utils/ILogger.js";
import type { IProvider } from "../../providers/BaseProvider.ts";
import type { IUtility } from "../../utilities/BaseUtility.ts";
import type { IService } from "../../services/BaseService.ts";

export type ModuleType = "provider" | "utility" | "service";
export type ModuleTypes = ModuleType | "app";
export type Module = IProvider | IUtility | IService;

/**
 * Config que define la identidad (`uniqueKey`) de un módulo. **Única fuente de verdad**:
 * el registro y cualquier pre-chequeo de deduplicación derivan la clave de acá.
 *
 * Las entradas `providers`/`utilities` de un `config.json` declaran sus settings bajo
 * `custom`; `config` es la forma sintética que usa `ModuleLoader` al registrar servicios
 * (lleva `__providers`). Cuando las dos caras divergían —registro por `custom`, pre-chequeo
 * por `config`— `hasModule()` nunca acertaba: el provider se cargaba y **arrancaba** de nuevo
 * por cada servicio que lo declaraba, y `#addModuleToRegistry` descartaba la instancia nueva
 * dejando su conexión (Mongo/S3/RabbitMQ) viva y sin dueño.
 */
export function moduleKeyConfig(config?: Pick<IModuleConfig, "custom" | "config"> | Record<string, any>): Record<string, any> {
	return config?.custom || config?.config || {};
}

export class ModuleRegistry {
	readonly #logger: ILogger = Logger.getLogger("ModuleRegistry");
	readonly #kernelKey: symbol;

	/**
	 * Instancia que está cargando en el flujo asíncrono actual.
	 *
	 * Es `AsyncLocalStorage` y no un slot global porque atribuye la **propiedad** de los
	 * providers: es lo que `cleanupAppModules` libera al descargar una app y lo que
	 * `getDependentAppNames` alimenta a la cascada de reload. Con un slot único, dos apps
	 * cargando a la vez se pisan el contexto → un provider queda anotado como dependencia
	 * de la app equivocada (descargar A decrementa un provider de B) y `#getModule`
	 * desambigua con el contexto ajeno, pudiendo devolver la conexión mongo de otra app.
	 */
	readonly #loadingContext = new AsyncLocalStorage<string>();

	readonly #appsRegistry = new Map<string, IApp>();

	readonly #moduleStore = Object.freeze({
		provider: Object.freeze({
			registry: new Map<string, IModule>(),
			nameMap: new Map<string, string[]>(),
			fileToUniqueKeyMap: new Map<string, string>(),
			refCount: new Map<string, number>(),
		}),
		utility: Object.freeze({
			registry: new Map<string, IModule>(),
			nameMap: new Map<string, string[]>(),
			fileToUniqueKeyMap: new Map<string, string>(),
			refCount: new Map<string, number>(),
		}),
		service: Object.freeze({
			registry: new Map<string, IModule>(),
			nameMap: new Map<string, string[]>(),
			fileToUniqueKeyMap: new Map<string, string>(),
			refCount: new Map<string, number>(),
		}),
	});

	readonly #appModuleDependencies = new Map<string, Set<{ type: ModuleType; uniqueKey: string }>>();

	/**
	 * Servicios de plataforma **pinneados**: nombre → instancia real. El nombre lo pone el
	 * walk de FS del `KernelServiceLoader` (el directorio del servicio), no el `name` que la
	 * clase se auto-declara, así que ata la identidad a la ruta de origen.
	 *
	 * Existe porque resolver por nombre es suplantable: `#getModule` desempata por longitud
	 * de `uniqueKey`, y una instancia registrada con `custom` no vacío produce una key más
	 * larga que la del servicio real (que suele ser el nombre pelado). El kernel y el
	 * orquestador entregan sus propias capabilities (`platform:infra`, `identity:internal`)
	 * al objeto que devuelve esa resolución, así que ganar el desempate alcanzaba para
	 * recibirlas. Con el pin, esos llamadores resuelven por identidad, no por nombre.
	 */
	readonly #platformServices = new Map<string, IModule>();

	constructor(kernelKey: symbol) {
		this.#kernelKey = kernelKey;
	}

	/**
	 * Pinnea (o re-pinnea tras un reload) un servicio de plataforma. Sólo el kernel: la
	 * `kernelKey` es la master key, que ningún módulo tiene.
	 */
	pinPlatformService(name: string, instance: IModule, kernelKey: symbol): void {
		if (!this.verifyKernelKey(kernelKey)) throw new Error("pinPlatformService: kernelKey inválida.");
		this.#platformServices.set(name, instance);
	}

	/** `true` si el nombre se pinneó en el boot (para re-pinnear sin admitir nombres nuevos). */
	isPlatformService(name: string): boolean {
		return this.#platformServices.has(name);
	}

	/**
	 * Servicio de plataforma por identidad pinneada.
	 *
	 * Fallback SÓLO si el nombre no está pinneado **y** hay exactamente una instancia con ese
	 * nombre (despliegue legítimo sin `kernelMode`). Ante ambigüedad devuelve `undefined` en
	 * vez de adivinar: en este camino el caller está por entregar una capability del kernel,
	 * así que equivocarse cuesta más que no resolver.
	 */
	getPlatformService<T>(name: string): T | undefined {
		const pinned = this.#platformServices.get(name);
		if (pinned) return pinned as T;
		if (this.getUniqueKeysByName("service", name).length !== 1) return undefined;
		try {
			return this.getService<T>(name);
		} catch {
			return undefined;
		}
	}

	/**
	 * Verifica que la kernelKey provista coincida con la registrada en construcción.
	 * No expone el símbolo: úsalo para gating de operaciones privilegiadas.
	 */
	verifyKernelKey(candidate: symbol): boolean {
		return candidate === this.#kernelKey;
	}

	/** Corre `fn` atribuyendo a `context` todo lo que se registre dentro (incluido el `await`). */
	runInLoadingContext<T>(context: string, fn: () => Promise<T>): Promise<T> {
		return this.#loadingContext.run(context, fn);
	}

	get #currentLoadingContext(): string | null {
		return this.#loadingContext.getStore() ?? null;
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
			// Colisión de `uniqueKey` entre instancias DISTINTAS: la nueva se descarta y el
			// llamador se queda con la vieja (no pisar lo que ya corre). Se avisa porque es
			// la firma de un módulo que se registra bajo el nombre de otro.
			if (registry.get(uniqueKey) !== instance) {
				this.#logger.logWarn(
					`${capitalizedModuleType} ${name}: ya hay otra instancia registrada bajo '${uniqueKey}'. Se descarta la nueva y se conserva la existente.`
				);
			} else if (!silent) {
				this.#logger.logDebug(`${capitalizedModuleType} ${name} reutilizado (Referencias: ${currentCount + 1})`);
			}
		} else {
			registry.set(uniqueKey, instance);
			refCountMap.set(uniqueKey, 1);
		}

		if (!nameMap.has(name)) {
			nameMap.set(name, []);
		}
		const keys = nameMap.get(name) ?? [];
		if (!keys.includes(uniqueKey)) {
			keys.push(uniqueKey);
		}

		if (!alreadyExists && !silent) {
			const uniqueInstances = new Set(keys.map((k) => registry.get(k))).size;
			this.#logger.logOk(`${capitalizedModuleType} registrado: ${name} (Instancias únicas: ${uniqueInstances})`);
		}

		if (effectiveAppName) {
			let deps = this.#appModuleDependencies.get(effectiveAppName);
			if (!deps) {
				deps = new Set();
				this.#appModuleDependencies.set(effectiveAppName, deps);
			}
			deps.add({ type: moduleType, uniqueKey });
		}
	}

	#registerModule(moduleType: ModuleType, name: string, instance: IModule, config: IModuleConfig, appName?: string | null): void {
		const uniqueKey = this.getUniqueKey(name, moduleKeyConfig(config));
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
					// El desempate por longitud de key es el que se usa para alias de una misma
					// instancia. Cuando las candidatas son instancias distintas no está
					// desambiguando: está eligiendo, y el criterio (key más larga = la que trae
					// más config) lo controla quien registra. Se avisa; los llamadores que
					// entregan capabilities del kernel no pasan por acá (ver `getPlatformService`).
					if (registry.get(sorted[0]) !== registry.get(sorted[1])) {
						this.#logger.logWarn(
							`Resolución ambigua de ${capitalizedModuleType} ${name}: ${filteredKeys.length} instancias distintas, se eligió '${sorted[0]}'.`
						);
					}
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

	/**
	 * true si hay al menos una instancia registrada bajo ese nombre, con o sin config
	 * (mismo lookup por nombre que usa `getService(name)` sin config). Permite chequear
	 * disponibilidad sin disparar el log de error de una resolución fallida.
	 */
	hasAnyModule(moduleType: ModuleType, name: string): boolean {
		const keys = this.#getNameMap(moduleType).get(name);
		return !!keys && keys.length > 0;
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

	getAppsRegistry(): ReadonlyMap<string, IApp> {
		return this.#appsRegistry;
	}

	addModuleDependency(moduleType: ModuleType, name: string, config?: Record<string, any>, appName?: string): void {
		const uniqueKey = this.getUniqueKey(name, config);
		const registry = this.#getRegistry(moduleType);

		const instance = registry.get(uniqueKey);
		if (!instance) {
			this.#logger.logWarn(`Intentando agregar dependencia de ${moduleType} ${name} que no existe en el registry`);
			return;
		}

		const effectiveAppName = appName || this.#currentLoadingContext;
		if (!effectiveAppName) return;

		// Reusar el módulo tiene que contar por TODAS sus claves, no sólo la del nombre pedido.
		// Un provider se registra bajo dos nombres (clase y módulo: `MongoProvider#h` y
		// `object/mongo#h`) apuntando a la MISMA instancia, cada uno con su refCount. Si al
		// reusarlo se bumpea una sola, la otra se queda en 1 y el `cleanupAppModules` de la
		// primera app que la soltó llama `stop()` sobre la instancia compartida, dejando sin
		// conexión a todas las demás.
		for (const key of this.#keysForInstance(moduleType, instance, uniqueKey)) {
			this.#trackDependency(moduleType, name, key, effectiveAppName);
		}
	}

	/** Claves bajo las que está registrada la misma instancia (aliases incluidos). */
	#keysForInstance(moduleType: ModuleType, instance: IModule, fallbackKey: string): string[] {
		const keys: string[] = [];
		for (const [key, value] of this.#getRegistry(moduleType).entries()) {
			if (value === instance) keys.push(key);
		}
		return keys.length > 0 ? keys : [fallbackKey];
	}

	#trackDependency(moduleType: ModuleType, name: string, uniqueKey: string, appName: string): void {
		let deps = this.#appModuleDependencies.get(appName);
		if (!deps) {
			deps = new Set();
			this.#appModuleDependencies.set(appName, deps);
		}
		if (Array.from(deps).some((d) => d.type === moduleType && d.uniqueKey === uniqueKey)) return;

		deps.add({ type: moduleType, uniqueKey });
		const refCountMap = this.#getRefCountMap(moduleType);
		const currentCount = refCountMap.get(uniqueKey) || 0;
		refCountMap.set(uniqueKey, currentCount + 1);
		this.#logger.logDebug(`Dependencia agregada: ${moduleType} ${name} para ${appName} (Referencias: ${currentCount + 1})`);
	}

	async cleanupAppModules(appName: string, kernelKey: symbol): Promise<void> {
		if (!this.verifyKernelKey(kernelKey)) {
			throw new Error("cleanupAppModules: kernelKey inválida.");
		}
		const dependencies = this.#appModuleDependencies.get(appName);
		if (!dependencies) return;

		for (const { type, uniqueKey } of dependencies) {
			await this.#releaseAppDependency(type, uniqueKey);
		}

		this.#appModuleDependencies.delete(appName);
	}

	async #releaseAppDependency(type: ModuleType, uniqueKey: string): Promise<void> {
		const refCountMap = this.#getRefCountMap(type);
		const currentCount = refCountMap.get(uniqueKey) || 0;

		if (currentCount > 1) {
			refCountMap.set(uniqueKey, currentCount - 1);
			this.#logger.logDebug(`Referencias decrementadas para ${type} ${uniqueKey}: ${currentCount - 1}`);
			return;
		}

		await this.#destroyModuleByKey(type, uniqueKey);
	}

	async #destroyModuleByKey(type: ModuleType, uniqueKey: string): Promise<void> {
		const registry = this.#getRegistry(type);
		const module = registry.get(uniqueKey);
		if (!module) return;

		// Un módulo registrado bajo varios nombres comparte instancia entre claves. Sólo se
		// para cuando ninguna OTRA clave que apunte a la misma instancia siga referenciada:
		// si no, liberar el alias mataría la conexión de quienes lo tienen por el otro nombre.
		const stillReferenced = this.#keysForInstance(type, module, uniqueKey).some(
			(key) => key !== uniqueKey && (this.#getRefCountMap(type).get(key) ?? 0) > 0
		);

		this.#logger.logDebug(`Limpiando ${type}: ${uniqueKey}${stillReferenced ? " (alias: la instancia sigue en uso)" : ""}`);
		if (!stillReferenced) await stopBoundModule(module, this.#kernelKey);
		registry.delete(uniqueKey);
		this.#getRefCountMap(type).delete(uniqueKey);
		this.#removeFromNameMap(type, uniqueKey);
	}

	#removeFromNameMap(type: ModuleType, uniqueKey: string): void {
		const nameMap = this.#getNameMap(type);
		for (const [name, keys] of nameMap.entries()) {
			const index = keys.indexOf(uniqueKey);
			if (index === -1) continue;
			keys.splice(index, 1);
			if (keys.length === 0) nameMap.delete(name);
		}
	}

	getUniqueKeysByName(moduleType: ModuleType, name: string): string[] {
		return [...(this.#getNameMap(moduleType).get(name) ?? [])];
	}

	/** Nombres lógicos de todos los módulos de un tipo registrados actualmente. */
	getModuleNames(moduleType: ModuleType): string[] {
		return [...this.#getNameMap(moduleType).keys()];
	}

	/** Instancia registrada bajo una uniqueKey (para deduplicar alias por identidad). */
	getInstanceByUniqueKey(moduleType: ModuleType, uniqueKey: string): IModule | undefined {
		return this.#getRegistry(moduleType).get(uniqueKey);
	}

	/** Snapshot inmutable de las dependencias app→módulo (para grafo de cascada). */
	getAppModuleDependencies(): ReadonlyMap<string, ReadonlySet<{ type: ModuleType; uniqueKey: string }>> {
		return this.#appModuleDependencies;
	}

	getDependentAppNames(moduleType: ModuleType, uniqueKey: string): string[] {
		const result: string[] = [];
		for (const [appName, deps] of this.#appModuleDependencies.entries()) {
			for (const dep of deps) {
				if (dep.type === moduleType && dep.uniqueKey === uniqueKey) {
					result.push(appName);
					break;
				}
			}
		}
		return result;
	}

	getDependentAppNamesByModuleName(moduleType: ModuleType, name: string): string[] {
		const keys = new Set(this.getUniqueKeysByName(moduleType, name));
		if (keys.size === 0) return [];
		const result = new Set<string>();
		for (const [appName, deps] of this.#appModuleDependencies.entries()) {
			for (const dep of deps) {
				if (dep.type === moduleType && keys.has(dep.uniqueKey)) {
					result.add(appName);
					break;
				}
			}
		}
		return [...result];
	}

	async unloadModuleByUniqueKey(moduleType: ModuleType, kernelKey: symbol, uniqueKey: string): Promise<void> {
		if (!this.verifyKernelKey(kernelKey)) {
			throw new Error("unloadModuleByUniqueKey: kernelKey inválida.");
		}
		const registry = this.#getRegistry(moduleType);
		const module = registry.get(uniqueKey);
		if (!module) return;
		const capitalizedModuleType = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);
		this.#logger.logDebug(`Removiendo ${capitalizedModuleType}: ${module.name} (${uniqueKey})`);
		// Descargar es el paso previo de todo reload/restart/rollback: el módulo se vuelve a
		// leer de disco, así que la resolución memoizada tiene que dejar de valer.
		VersionResolver.invalidateResolutionCache();
		await stopBoundModule(module, this.#kernelKey);
		registry.delete(uniqueKey);
		this.#getRefCountMap(moduleType).delete(uniqueKey);

		const nameMap = this.#getNameMap(moduleType);
		const keys = nameMap.get(module.name);
		if (keys) {
			const index = keys.indexOf(uniqueKey);
			if (index > -1) keys.splice(index, 1);
			if (keys.length === 0) nameMap.delete(module.name);
		}

		const fileMap = this.getFileToUniqueKeyMap(moduleType);
		for (const [filePath, key] of fileMap.entries()) {
			if (key === uniqueKey) fileMap.delete(filePath);
		}
	}

	async unloadModulesByName(moduleType: ModuleType, kernelKey: symbol, name: string): Promise<void> {
		const keys = this.getUniqueKeysByName(moduleType, name);
		for (const uniqueKey of keys) {
			await this.unloadModuleByUniqueKey(moduleType, kernelKey, uniqueKey);
		}
	}

	async unloadModule(moduleType: ModuleType, kernelKey: symbol, filePath: string): Promise<void> {
		if (!this.verifyKernelKey(kernelKey)) {
			throw new Error("unloadModule: kernelKey inválida.");
		}
		const fileMap = this.getFileToUniqueKeyMap(moduleType);
		const uniqueKey = fileMap.get(filePath);
		if (!uniqueKey) return;

		const registry = this.#getRegistry(moduleType);
		const module = registry.get(uniqueKey);
		if (module) {
			const capitalizedModuleType = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);
			this.#logger.logDebug(`Removiendo ${capitalizedModuleType}: ${module.name}`);
			VersionResolver.invalidateResolutionCache();
			await stopBoundModule(module, this.#kernelKey);
			registry.delete(uniqueKey);

			const nameMap = this.#getNameMap(moduleType);
			const keys = nameMap.get(module.name);
			if (keys) {
				const index = keys.indexOf(uniqueKey);
				if (index > -1) keys.splice(index, 1);
			}
		}
		fileMap.delete(filePath);
	}

	async stopAllModules(
		kernelKey: symbol,
		withTimeout: <T>(promise: Promise<T>, timeoutMs: number, name: string) => Promise<T | undefined>
	): Promise<void> {
		if (!this.verifyKernelKey(kernelKey)) {
			throw new Error("stopAllModules: kernelKey inválida.");
		}
		for (const moduleType of ["provider", "utility", "service"] as ModuleType[]) {
			const capitalizedModuleType = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);
			this.#logger.logInfo(`Deteniendo ${capitalizedModuleType === "Utility" ? "Utilitie" : capitalizedModuleType}s...`);
			const registry = this.#getRegistry(moduleType);
			for (const [key, instance] of registry) {
				try {
					this.#logger.logDebug(`Deteniendo ${capitalizedModuleType} ${key}`);
					await withTimeout(stopBoundModule(instance, this.#kernelKey), 2500, `${capitalizedModuleType} ${key}`);
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

}
