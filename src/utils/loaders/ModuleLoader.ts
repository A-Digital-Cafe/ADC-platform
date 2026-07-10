import * as path from "node:path";
import { promises as fs } from "node:fs";
import { LoaderManager } from "./LoaderManager.js";
import { IModuleConfig } from "../../interfaces/modules/IModule.js";
import type { BaseProvider } from "../../providers/BaseProvider.ts";
import type { IUtility } from "../../utilities/BaseUtility.ts";
import type { BaseService } from "../../services/BaseService.ts";
import { Kernel } from "../../kernel.js";
import type { ModuleRegistry } from "../registry/ModuleRegistry.js";
import { Logger } from "../logger/Logger.js";
import { VersionResolver } from "../VersionResolver.js";
import { safeParseJson, parseJsonOrThrow } from "@common/utils/json-schema.ts";
import { moduleConfigCheck } from "@common/schemas/module-config.ts";
import { isInsideAnyBase } from "@common/utils/path-containment.ts";

export class ModuleLoader {
	readonly #basePath = path.resolve(process.cwd(), "src");
	readonly #presetsPath = path.resolve(process.cwd(), "presets");

	#providersPath: string[] = [path.resolve(this.#basePath, "providers")];
	#utilitiesPath: string[] = [path.resolve(this.#basePath, "utilities")];
	#servicesPath: string[] = [path.resolve(this.#basePath, "services")];

	/**
	 * Registra los presets descubiertos por el Kernel para que los lookups de
	 * providers/utilities/services consideren también `presets/<topic>/<layer>`.
	 * Llamar una sola vez al inicio; idempotente.
	 */
	public setPresetTopics(topics: string[]): void {
		const layerPaths = (layer: "providers" | "utilities" | "services") => topics.map((t) => path.resolve(this.#presetsPath, t, layer));
		this.#providersPath = [path.resolve(this.#basePath, "providers"), ...layerPaths("providers")];
		this.#utilitiesPath = [path.resolve(this.#basePath, "utilities"), ...layerPaths("utilities")];
		this.#servicesPath = [path.resolve(this.#basePath, "services"), ...layerPaths("services")];
	}

	readonly #configCache = new Map<string, IModuleConfig>();
	readonly #envCache = new Map<string, Record<string, string>>();

	readonly #kernelKey: symbol;

	readonly #loaderManager: LoaderManager;

	/**
	 * Extrae el nombre real del provider/módulo eliminando un prefijo de alias.
	 * Acepta formato `alias@providerName` (p.ej. `"discord@object/mongo"` → `"object/mongo"`).
	 * Si no contiene `@`, devuelve el nombre tal cual.
	 */
	static #stripAlias(name: string): string {
		const at = name.indexOf("@");
		return at >= 0 ? name.slice(at + 1) : name;
	}

	static #shouldSkipOptionalProvider(config: IModuleConfig): boolean {
		if (!config.optional) return false;
		const uri = config.custom?.uri;
		return typeof uri === "string" && uri.trim() === "";
	}

	constructor(kernelKey: symbol) {
		this.#kernelKey = kernelKey;
		this.#loaderManager = new LoaderManager(this.#kernelKey);
	}

	public getConfigByPath(modulePath: string): IModuleConfig | undefined {
		return this.#configCache.get(modulePath);
	}

	/**
	 * Obtiene las variables de entorno cargadas para un módulo específico
	 */
	public getEnvByPath(modulePath: string): Record<string, string> | undefined {
		return this.#envCache.get(modulePath);
	}

	private static readonly kvRegex = new RegExp(/^([^=]+)=(.*)$/);

	/**
	 * Lee y parsea un archivo .env sin inyectarlo a process.env
	 * @param envPath - Ruta al archivo .env
	 * @returns Un objeto con las variables de entorno parseadas
	 */
	public async loadEnvFile(envPath: string): Promise<Record<string, string>> {
		try {
			const envContent = await fs.readFile(envPath, "utf-8");
			const envVars: Record<string, string> = {};

			// Parsear el contenido del archivo .env
			for (const line of envContent.split("\n")) {
				const trimmedLine = line.trim();

				// Ignorar líneas vacías y comentarios
				if (!trimmedLine || trimmedLine.startsWith("#")) {
					continue;
				}

				// Buscar el patrón KEY=VALUE
				const match = ModuleLoader.kvRegex.exec(trimmedLine);
				if (match) {
					const key = match[1].trim();
					let value = match[2].trim();

					// Remover comillas si existen
					if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
						value = value.slice(1, -1);
					}

					envVars[key] = value;
				}
			}

			Logger.debug(`[ModuleLoader] Variables de entorno cargadas desde ${envPath}: ${Object.keys(envVars).length} variables`);
			return envVars;
		} catch (error: any) {
			// Si el archivo no existe o no se puede leer, retornar objeto vacío
			if (error.code === "ENOENT") {
				Logger.debug(`[ModuleLoader] No se encontró archivo .env en ${envPath}`);
			} else {
				Logger.warn(`[ModuleLoader] Error leyendo archivo .env en ${envPath}: ${error.message}`);
			}
			return {};
		}
	}

	/**
	 * Interpola variables de entorno en un objeto de configuración
	 * Reemplaza ${VAR_NAME} con el valor de process.env.VAR_NAME o del envVars proporcionado
	 * @param obj - Objeto a interpolar
	 * @param envVars - Variables de entorno específicas del módulo (opcionales)
	 */
	public interpolateEnvVars(obj: any, envVars?: Record<string, string>): any {
		if (typeof obj === "string") {
			return obj.replaceAll(/\$\{([^}]+)\}/g, (_, varSpec) => {
				const [varName, defaultValue] = String(varSpec).split(":-");
				// Priorizar variables del módulo, luego process.env
				return envVars?.[varName] || process.env[varName] || defaultValue || "";
			});
		}

		if (Array.isArray(obj)) {
			return obj.map((item) => this.interpolateEnvVars(item, envVars));
		}

		if (obj && typeof obj === "object") {
			const result: any = {};
			for (const [key, value] of Object.entries(obj)) {
				result[key] = this.interpolateEnvVars(value, envVars);
			}
			return result;
		}

		return obj;
	}

	/**
	 * `true` si el módulo está marcado como deshabilitado en runtime (modules-manager).
	 * Evita que un service/provider/utility deshabilitado se vuelva a cargar como
	 * dependencia de una app/servicio (p.ej. tras reiniciar el kernel). Degrada a
	 * "no deshabilitado" si el orquestador aún no está disponible.
	 */
	#isModuleDisabled(kernel: Kernel, type: "provider" | "utility" | "service", name: string): boolean {
		try {
			return kernel.getOrchestrator(this.#kernelKey).isDisabled(type, name);
		} catch {
			return false;
		}
	}

	/**
	 * Carga todos los módulos (providers, utilities, services) desde un objeto de definición de módulos.
	 * Usa el contexto de carga del kernel para reference counting.
	 * @param modulesConfig - El objeto de definición de módulos.
	 * @param kernel - La instancia del kernel.
	 */
	async loadAllModulesFromDefinition(modulesConfig: IModuleConfig, kernel: Kernel): Promise<void> {
		const registry = kernel.getMutableRegistry(this.#kernelKey);
		try {
			await this.#loadGlobalProviders(modulesConfig, kernel, registry);
			await this.#loadGlobalUtilities(modulesConfig, kernel, registry);
			await this.#loadServices(modulesConfig, kernel, registry);
		} catch (error) {
			const message = `Error procesando la definición de módulos`;
			Logger.error(message);
			throw new Error(message, { cause: error });
		}
	}

	/** Lanza (envolviendo `error`) si la definición pide failOnError; si no, degrada a warn. */
	static #failOrWarn(failOnError: boolean | undefined, message: string, error: unknown): void {
		if (failOnError) throw new Error(message, { cause: error });
		Logger.warn(message);
	}

	/** Registra el provider por el nombre de su clase y, si difiere, por el nombre del módulo. */
	#registerProviderBothNames(registry: ModuleRegistry, provider: BaseProvider, config: IModuleConfig, appName?: string | null): void {
		registry.registerProvider(provider.name, provider, config, appName);
		if (config.name !== provider.name) {
			registry.registerProvider(config.name, provider, config, appName);
		}
	}

	/** Registra la utility y, si su nombre contiene "/", también el nombre base como alias. */
	#registerUtilityWithAlias(registry: ModuleRegistry, utility: IUtility, config: IModuleConfig, appName?: string | null): void {
		registry.registerUtility(utility.name, utility, config, appName);
		if (config.name.includes("/")) {
			const baseName = config.name.split("/").pop()!;
			registry.registerUtility(baseName, utility, config, appName);
		}
	}

	/**
	 * Providers globales de la definición. NO se registran como dependencias de
	 * la app (appName null): sólo cuentan como dependencia cuando un servicio los usa.
	 */
	async #loadGlobalProviders(modulesConfig: IModuleConfig, kernel: Kernel, registry: ModuleRegistry): Promise<void> {
		const providers = Array.isArray(modulesConfig.providers) ? modulesConfig.providers : [];
		for (const providerConfig of providers) {
			const config = this.interpolateEnvVars(providerConfig);
			if (this.#isModuleDisabled(kernel, "provider", config.name)) {
				Logger.warn(`[ModuleLoader] Provider ${config.name} deshabilitado (modules-manager): no se carga.`);
				continue;
			}
			if (ModuleLoader.#shouldSkipOptionalProvider(config)) {
				Logger.debug(`[ModuleLoader] Provider opcional ${config.name} omitido (uri vacía)`);
				continue;
			}
			if (registry.hasModule("provider", config.name, config.config)) {
				Logger.debug(`[ModuleLoader] Provider global ${config.name} ya existe, saltando`);
				continue;
			}
			try {
				const provider = await this.loadProvider(config);
				this.#registerProviderBothNames(registry, provider, config, null);
			} catch (error) {
				ModuleLoader.#failOrWarn(modulesConfig.failOnError, `Error cargando provider ${providerConfig.name}`, error);
			}
		}
	}

	/** Utilities globales de la definición (tampoco se registran como dependencias de la app). */
	async #loadGlobalUtilities(modulesConfig: IModuleConfig, kernel: Kernel, registry: ModuleRegistry): Promise<void> {
		const utilities = Array.isArray(modulesConfig.utilities) ? modulesConfig.utilities : [];
		for (const utilityConfig of utilities) {
			if (this.#isModuleDisabled(kernel, "utility", utilityConfig.name)) {
				Logger.warn(`[ModuleLoader] Utility ${utilityConfig.name} deshabilitado (modules-manager): no se carga.`);
				continue;
			}
			try {
				const utility = await this.loadUtility(utilityConfig);
				this.#registerUtilityWithAlias(registry, utility, utilityConfig, null);
			} catch (error) {
				ModuleLoader.#failOrWarn(modulesConfig.failOnError, `Error cargando utility ${utilityConfig.name}`, error);
			}
		}
	}

	/** Services de la definición, cada uno con sus providers/utilities propios. */
	async #loadServices(modulesConfig: IModuleConfig, kernel: Kernel, registry: ModuleRegistry): Promise<void> {
		const services = Array.isArray(modulesConfig.services) ? modulesConfig.services : [];
		for (const serviceConfig of services) {
			if (this.#isModuleDisabled(kernel, "service", serviceConfig.name)) {
				Logger.warn(`[ModuleLoader] Service ${serviceConfig.name} deshabilitado (modules-manager): no se carga.`);
				continue;
			}
			try {
				await this.#loadServiceFromDefinition(serviceConfig, modulesConfig, kernel, registry);
			} catch (error) {
				ModuleLoader.#failOrWarn(modulesConfig.failOnError, `Error cargando service ${serviceConfig.name}`, error);
			}
		}
	}

	/**
	 * Carga un servicio de la definición: resuelve env/providers para calcular su
	 * uniqueKey, reutiliza instancias existentes, y si no hay, carga providers y
	 * utilities propios, instancia el servicio y lo registra con sus dependencias.
	 */
	async #loadServiceFromDefinition(
		serviceConfig: IModuleConfig,
		modulesConfig: IModuleConfig,
		kernel: Kernel,
		registry: ModuleRegistry
	): Promise<void> {
		// Clonar la configuración para poder mutarla, ya que el original está congelado
		const mutableServiceConfig = structuredClone(serviceConfig);

		const serviceEnvVars = await this.#loadServiceEnvVars(serviceConfig);
		const finalProviders = await this.#resolveServiceProviders(mutableServiceConfig, serviceConfig, serviceEnvVars);

		// Config que define el uniqueKey del servicio
		const serviceUniqueConfig = { ...serviceConfig.config, __providers: finalProviders };

		if (registry.hasModule("service", serviceConfig.name, serviceUniqueConfig)) {
			Logger.debug(`[ModuleLoader] Servicio ${serviceConfig.name} ya existe, reutilizando instancia`);
			registry.addModuleDependency("service", serviceConfig.name, serviceUniqueConfig);
			return;
		}

		// Reutilizar instancia kernel-mode (registrada con su propio uniqueKey) si existe
		if (registry.getUniqueKeysByName("service", serviceConfig.name).length > 0) {
			Logger.debug(`[ModuleLoader] Servicio ${serviceConfig.name} ya cargado (kernel-mode u otro), reutilizando`);
			registry.addModuleDependency("service", serviceConfig.name);
			return;
		}

		await this.#loadServiceScopedProviders(mutableServiceConfig, serviceConfig.name, serviceEnvVars, modulesConfig, registry);
		await this.#loadServiceScopedUtilities(mutableServiceConfig, serviceConfig.name, modulesConfig, registry);

		// Cargar el servicio (que ahora puede acceder a sus providers del kernel)
		const service = await this.loadService(mutableServiceConfig, kernel);

		// Registrar los providers del servicio como dependencias de la app (reference counting)
		this.#registerServiceProviderDeps(mutableServiceConfig, serviceEnvVars, registry);

		// Registrar el servicio con el config que incluye providers
		registry.registerService(service.name, service, {
			name: serviceConfig.name,
			version: serviceConfig.version,
			language: serviceConfig.language,
			config: serviceUniqueConfig,
		});
	}

	/** Variables de entorno del `.env` del servicio (objeto vacío si no hay o falla). */
	async #loadServiceEnvVars(serviceConfig: IModuleConfig): Promise<Record<string, string>> {
		try {
			const resolved = await VersionResolver.resolveModuleVersion(
				this.#servicesPath,
				serviceConfig.name,
				serviceConfig.version,
				serviceConfig.language
			);
			if (!resolved) return {};
			// resolved.path ya es el directorio del servicio
			const envPath = path.join(resolved.path, ".env");
			Logger.debug(`[ModuleLoader] Intentando cargar .env del servicio desde: ${envPath}`);
			const serviceEnvVars = await this.loadEnvFile(envPath);
			Logger.debug(`[ModuleLoader] Variables del servicio ${serviceConfig.name}: ${JSON.stringify(Object.keys(serviceEnvVars))}`);
			return serviceEnvVars;
		} catch (error) {
			Logger.warn(`[ModuleLoader] Error cargando variables de entorno del servicio ${serviceConfig.name}: ${error}`);
			return {};
		}
	}

	/**
	 * Providers efectivos del servicio para calcular su uniqueKey: los de la
	 * definición o, si no declara, los de su propio config.json; interpolados
	 * con las variables del servicio.
	 */
	async #resolveServiceProviders(
		mutableServiceConfig: IModuleConfig,
		serviceConfig: IModuleConfig,
		serviceEnvVars: Record<string, string>
	): Promise<IModuleConfig["providers"]> {
		let finalProviders = mutableServiceConfig.providers;
		if (!finalProviders || finalProviders.length === 0) {
			try {
				const resolved = await VersionResolver.resolveModuleVersion(
					this.#servicesPath,
					serviceConfig.name,
					serviceConfig.version,
					serviceConfig.language
				);
				if (resolved) {
					// resolved.path es el directorio del servicio, no el archivo
					const configContent = await fs.readFile(path.join(resolved.path, "config.json"), "utf-8");
					const configJson = safeParseJson(configContent, moduleConfigCheck);
					if (configJson?.providers && Array.isArray(configJson.providers)) {
						finalProviders = configJson.providers;
					}
				}
			} catch {
				// Si no se puede leer, usar el array vacío
			}
		}
		return finalProviders ? this.interpolateEnvVars(finalProviders, serviceEnvVars) : finalProviders;
	}

	/**
	 * Providers propios (no globales) del servicio: se cargan una sola vez en el
	 * kernel y se reutilizan si ya existen con el mismo config.
	 */
	async #loadServiceScopedProviders(
		mutableServiceConfig: IModuleConfig,
		serviceName: string,
		serviceEnvVars: Record<string, string>,
		modulesConfig: IModuleConfig,
		registry: ModuleRegistry
	): Promise<void> {
		const providers = Array.isArray(mutableServiceConfig.providers) ? mutableServiceConfig.providers : [];
		for (const providerConfig of providers) {
			// Solo cargar si no es global (los globales ya fueron cargados)
			if (providerConfig.global) continue;

			const config = this.interpolateEnvVars(providerConfig, serviceEnvVars);
			Logger.debug(`[ModuleLoader] Provider config interpolado para ${serviceName}: ${JSON.stringify(config)}`);

			if (ModuleLoader.#shouldSkipOptionalProvider(config)) {
				Logger.debug(`[ModuleLoader] Provider opcional ${config.name} omitido (uri vacía)`);
				continue;
			}
			if (registry.hasModule("provider", config.name, config.config)) {
				Logger.debug(`[ModuleLoader] Provider ${config.name} ya existe, reutilizando`);
				registry.addModuleDependency("provider", config.name, config.config);
				continue;
			}
			try {
				const provider = await this.loadProvider(config, serviceEnvVars);
				this.#registerProviderBothNames(registry, provider, config);
			} catch (error) {
				ModuleLoader.#failOrWarn(
					modulesConfig.failOnError,
					`Error cargando provider ${config.name} del servicio ${serviceName}`,
					error
				);
			}
		}
	}

	/** Utilities propias (no globales) del servicio. */
	async #loadServiceScopedUtilities(
		mutableServiceConfig: IModuleConfig,
		serviceName: string,
		modulesConfig: IModuleConfig,
		registry: ModuleRegistry
	): Promise<void> {
		const utilities = Array.isArray(mutableServiceConfig.utilities) ? mutableServiceConfig.utilities : [];
		for (const utilityConfig of utilities) {
			if (utilityConfig.global) {
				Logger.debug(`[ModuleLoader] Saltando utility global: ${utilityConfig.name}`);
				continue;
			}
			try {
				const utility = await this.loadUtility(utilityConfig);
				this.#registerUtilityWithAlias(registry, utility, utilityConfig);
			} catch (error) {
				ModuleLoader.#failOrWarn(
					modulesConfig.failOnError,
					`Error cargando utility ${utilityConfig.name} del servicio ${serviceName}`,
					error
				);
			}
		}
	}

	/** Registra los providers del servicio como dependencias de la app actual (reference counting). */
	#registerServiceProviderDeps(
		mutableServiceConfig: IModuleConfig,
		serviceEnvVars: Record<string, string>,
		registry: ModuleRegistry
	): void {
		const providers = Array.isArray(mutableServiceConfig.providers) ? mutableServiceConfig.providers : [];
		for (const providerConfig of providers) {
			const config = this.interpolateEnvVars(providerConfig, serviceEnvVars);
			if (ModuleLoader.#shouldSkipOptionalProvider(config)) continue;
			// addModuleDependency también maneja automáticamente los aliases (type)
			registry.addModuleDependency("provider", config.name, config.config);
		}
	}

	/**
	 * Carga un Provider desde su configuración.
	 * @param config - Configuración del provider
	 * @param parentEnvVars - Variables de entorno del módulo padre (servicio) que usa este provider
	 */
	async loadProvider(config: IModuleConfig, parentEnvVars?: Record<string, string>): Promise<BaseProvider> {
		const language = config.language || "typescript";
		const version = config.version || "latest";

		// Soporte de alias `alias@providerName` (p.ej. "discord@object/mongo").
		// La parte tras `@` identifica el provider real a cargar; el alias completo
		// se conserva en `config.name` para que la registry pueda diferenciar instancias
		// del mismo provider type con distintos `custom`.
		const resolvedProviderName = ModuleLoader.#stripAlias(config.name);

		Logger.debug(`[ModuleLoader] Cargando Provider: ${config.name} (v${version}, ${language})`);

		// Resolver la versión correcta
		const resolved = await VersionResolver.resolveModuleVersion(this.#providersPath, resolvedProviderName, version, language);

		if (!resolved) {
			throw new Error(`No se pudo resolver Provider: ${config.name}@${version} (${language})`);
		}

		this.#configCache.set(resolved.path, config);

		// Cargar variables de entorno del módulo si existe .env
		// resolved.path ya es el directorio del provider
		const envPath = path.join(resolved.path, ".env");
		const providerEnvVars = await this.loadEnvFile(envPath);

		// Fusionar variables: prioridad a las del padre (servicio), luego las propias del provider
		const mergedEnvVars = { ...providerEnvVars, ...parentEnvVars };
		this.#envCache.set(resolved.path, mergedEnvVars);

		// Obtener el loader correcto
		const loader = this.#loaderManager.getLoader(language);

		// Interpolar variables de entorno en todas las propiedades del config
		const interpolatedConfig = this.interpolateEnvVars(config, mergedEnvVars);

		// Enriquecer config con información del módulo para interoperabilidad
		// Incluir custom, private, options y cualquier otra propiedad
		// Nota: "private" no afecta el uniqueKey, solo se pasa al módulo
		const enrichedConfig = {
			...interpolatedConfig.custom,
			...interpolatedConfig.private,
			...interpolatedConfig.options,
			...interpolatedConfig.config,
			moduleName: interpolatedConfig.name,
			moduleVersion: resolved.version,
			language: language,
			type: interpolatedConfig.type,
		};

		// Cargar el módulo
		return await loader.loadProvider(resolved.path, enrichedConfig);
	}

	/**
	 * Carga un Utility desde su configuración.
	 */
	async loadUtility(config: IModuleConfig): Promise<IUtility> {
		const language = config.language || "typescript";
		const version = config.version || "latest";

		Logger.debug(`[ModuleLoader] Cargando Utility: ${config.name} (v${version}, ${language})`);

		// Resolver la versión correcta
		const resolved = await VersionResolver.resolveModuleVersion(this.#utilitiesPath, config.name, version, language);

		if (!resolved) {
			throw new Error(`No se pudo resolver Utility: ${config.name}@${version} (${language})`);
		}
		this.#configCache.set(resolved.path, config);

		// Cargar variables de entorno del módulo si existe .env
		// resolved.path ya es el directorio de la utility
		const envPath = path.join(resolved.path, ".env");
		const envVars = await this.loadEnvFile(envPath);
		this.#envCache.set(resolved.path, envVars);

		// Obtener el loader correcto
		const loader = this.#loaderManager.getLoader(language);

		// Interpolar variables de entorno
		const interpolatedConfig = this.interpolateEnvVars(config, envVars);

		// Enriquecer config con información del módulo
		// Nota: "private" no afecta el uniqueKey, solo se pasa al módulo
		const enrichedConfig = {
			...interpolatedConfig.custom,
			...interpolatedConfig.private,
			...interpolatedConfig.options,
			...interpolatedConfig.config,
			moduleName: interpolatedConfig.name,
			moduleVersion: resolved.version,
			language: language,
			type: interpolatedConfig.type,
		};

		// Cargar el módulo
		return await loader.loadUtility(resolved.path, enrichedConfig);
	}

	/**
	 * Carga un Service desde su configuración.
	 */
	async loadService(config: IModuleConfig, kernel: Kernel): Promise<BaseService> {
		const language = config.language || "typescript";
		const version = config.version || "latest";

		Logger.debug(`[ModuleLoader] Cargando Service: ${config.name} (v${version}, ${language})`);

		// Resolver la versión correcta
		const resolved = await VersionResolver.resolveModuleVersion(this.#servicesPath, config.name, version, language);

		if (!resolved) {
			throw new Error(`No se pudo resolver Service: ${config.name}@${version} (${language})`);
		}

		this.#configCache.set(resolved.path, config);

		// Cargar variables de entorno del módulo si existe .env
		// resolved.path ya es el directorio del servicio
		const envPath = path.join(resolved.path, ".env");
		const envVars = await this.loadEnvFile(envPath);
		this.#envCache.set(resolved.path, envVars);

		// Obtener el loader correcto
		const loader = this.#loaderManager.getLoader(language);

		// Interpolar variables de entorno
		const interpolatedConfig = this.interpolateEnvVars(config, envVars);

		// Enriquecer config con información del módulo
		// Nota: "private" no afecta el uniqueKey, solo se pasa al módulo
		const enrichedConfig = {
			...interpolatedConfig.custom,
			...interpolatedConfig.private,
			...interpolatedConfig.options,
			...interpolatedConfig.config,
			moduleName: interpolatedConfig.name,
			moduleVersion: resolved.version,
			language: language,
			type: interpolatedConfig.type,
			__modulePath: resolved.path, // Path del módulo para que BaseService.start() lo use
		};

		return await loader.loadService(resolved.path, kernel, enrichedConfig);
	}

	async loadKernelService(
		servicePath: string,
		configPath: string,
		kernel: Kernel,
		kernelKey: symbol
	): Promise<{ instance: BaseService; config: IModuleConfig }> {
		const registry = kernel.getMutableRegistry(kernelKey);
		const serviceDir = path.dirname(servicePath);
		const serviceName = path.basename(serviceDir);

		const envPath = path.join(serviceDir, ".env");
		const serviceEnvVars = await this.loadEnvFile(envPath);

		const configContent = await fs.readFile(configPath, "utf-8");
		const rawConfig = parseJsonOrThrow(configContent, moduleConfigCheck, `service config ${configPath}`);
		const serviceConfig = this.interpolateEnvVars(rawConfig, serviceEnvVars);

		await this.#loadKernelServiceProviders(serviceConfig, serviceEnvVars, registry);

		// Anti path-traversal: el servicePath viene del walk de FS de las raíces de
		// servicios; antes de ejecutar su código (import = code execution) se exige
		// que quede contenido en alguna raíz permitida.
		if (!isInsideAnyBase(this.#servicesPath, servicePath)) {
			throw new Error(`[ModuleLoader] servicePath fuera de las raíces de servicios permitidas, carga abortada: ${servicePath}`);
		}

		const serviceModule = await import(servicePath);
		const ServiceClass = serviceModule.default;

		if (!ServiceClass) {
			throw new Error(`No se encontró export default en ${servicePath}`);
		}

		const instance: BaseService = new ServiceClass(kernel, {
			name: serviceName,
			custom: serviceConfig.custom,
			...serviceConfig.private, // Config privado que no afecta uniqueKey
			providers: serviceConfig.providers || [],
			utilities: serviceConfig.utilities || [],
			services: serviceConfig.services || [],
			__modulePath: serviceDir,
		});
		const lifecycleToken = kernel.provisionModule(kernelKey, instance, {
			name: serviceName,
			kind: "service",
			path: serviceDir,
			declared: Array.isArray(serviceConfig.privileges) ? serviceConfig.privileges : undefined,
		});
		await instance.start(lifecycleToken);

		const registrationConfig: IModuleConfig = {
			name: serviceName,
			version: "1.0.0",
			language: "typescript",
			global: true,
			config: { __providers: serviceConfig.providers || [] },
		};

		return { instance, config: registrationConfig };
	}

	/** Providers de un servicio kernel-mode (config ya interpolado; no cuentan como dependencia de app). */
	async #loadKernelServiceProviders(
		serviceConfig: IModuleConfig,
		serviceEnvVars: Record<string, string>,
		registry: ModuleRegistry
	): Promise<void> {
		const providers = Array.isArray(serviceConfig.providers) ? serviceConfig.providers : [];
		for (const providerConfig of providers) {
			if (ModuleLoader.#shouldSkipOptionalProvider(providerConfig)) {
				Logger.debug(`[ModuleLoader] Provider opcional ${providerConfig.name} omitido (uri vacía)`);
				continue;
			}
			if (registry.hasModule("provider", providerConfig.name, providerConfig.config)) {
				Logger.debug(`[ModuleLoader] Provider ${providerConfig.name} ya existe`);
				continue;
			}
			const provider = await this.loadProvider(providerConfig, serviceEnvVars);
			this.#registerProviderBothNames(registry, provider, providerConfig, null);
		}
	}
}
