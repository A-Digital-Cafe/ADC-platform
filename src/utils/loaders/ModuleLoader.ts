import * as path from "node:path";
import { promises as fs } from "node:fs";
import { LoaderManager } from "./LoaderManager.js";
import { IModuleConfig } from "../../interfaces/modules/IModule.js";
import type { BaseProvider } from "../../providers/BaseProvider.ts";
import type { IUtility } from "../../utilities/BaseUtility.ts";
import type { BaseService } from "../../services/BaseService.ts";
import { Kernel } from "../../kernel.js";
import { moduleKeyConfig, type ModuleRegistry } from "../registry/ModuleRegistry.js";
import { Logger } from "../logger/Logger.js";
import { VersionResolver } from "../VersionResolver.js";
import { safeParseJson, parseJsonOrThrow } from "@common/utils/json-schema.ts";
import { platformSetting } from "@common/utils/platform-settings.ts";
import { moduleConfigCheck } from "@common/schemas/module-config.ts";
import { isInsideAnyBase } from "@common/utils/path-containment.ts";
import { runDevCleanup } from "@common/utils/dev-cleanup.ts";

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
	 *
	 * Precedencia: `.env` del módulo → **configuración de plataforma** (Mongo) → `process.env` →
	 * default del `${VAR:-default}`.
	 *
	 * La configuración de plataforma le gana al entorno porque es del clúster: si ganara el archivo
	 * local, una línea olvidada en un nodo lo dejaría distinto del resto sin que nadie se entere. Que
	 * una variable quede ignorada lo avisa por log el servicio de configuración al arrancar, y sólo
	 * alcanza a los nombres declarados en su `defaults.json`.
	 *
	 * @param obj - Objeto a interpolar
	 * @param envVars - Variables de entorno específicas del módulo (opcionales)
	 */
	public interpolateEnvVars(obj: any, envVars?: Record<string, string>): any {
		if (typeof obj === "string") {
			return obj.replaceAll(/\$\{([^}]+)\}/g, (_, varSpec) => {
				const [varName, defaultValue] = String(varSpec).split(":-");
				// Priorizar variables del módulo, luego la configuración de plataforma, luego process.env
				return envVars?.[varName] || platformSetting(varName) || process.env[varName] || defaultValue || "";
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

	/**
	 * Construcciones en vuelo, por clave de módulo. Existe porque el patrón
	 * `hasModule() → await loadX() → register()` tiene un `await` en el medio: con dos apps
	 * cargando a la vez, ambas pasan el chequeo, ambas construyen y el registry descarta una
	 * **después** de que abrió su conexión (Mongo/S3/RabbitMQ), dejándola viva y sin dueño.
	 * Con single-flight la segunda espera a la primera en vez de construir en paralelo.
	 */
	readonly #inFlight = new Map<string, Promise<void>>();

	/**
	 * Corre `task` una sola vez por `key` mientras esté en vuelo. Los que llegan tarde
	 * comparten la misma promesa —incluido su rechazo—, así que cada llamador conserva su
	 * propio manejo de error (`failOnError`) alrededor de esta llamada.
	 */
	#loadOnce(key: string, task: () => Promise<void>): Promise<void> {
		const pending = this.#inFlight.get(key);
		if (pending) return pending;
		const run = task().finally(() => this.#inFlight.delete(key));
		this.#inFlight.set(key, run);
		return run;
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

	/**
	 * Registra la utility y, si el nombre del config trae ruta ("attachments/attachments-utility"),
	 * también el nombre base como alias.
	 *
	 * El alias se omite cuando ya coincide con `utility.name` —el caso normal, porque la clase
	 * se auto-declara con el nombre de su carpeta—: sería registrar la MISMA instancia bajo la
	 * MISMA `uniqueKey`, que cae en la rama `alreadyExists` del registry y duplica su log y su
	 * refCount.
	 */
	#registerUtilityWithAlias(registry: ModuleRegistry, utility: IUtility, config: IModuleConfig, appName?: string | null): void {
		registry.registerUtility(utility.name, utility, config, appName);
		const baseName = config.name.includes("/") ? config.name.split("/").pop()! : null;
		if (baseName && baseName !== utility.name) {
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
			const keyConfig = moduleKeyConfig(config);
			try {
				await this.#loadOnce(`provider|${registry.getUniqueKey(config.name, keyConfig)}`, async () => {
					if (registry.hasModule("provider", config.name, keyConfig)) {
						Logger.debug(`[ModuleLoader] Provider global ${config.name} ya existe, saltando`);
						return;
					}
					const provider = await this.loadProvider(config);
					this.#registerProviderBothNames(registry, provider, config, null);
				});
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
				await this.loadAndRegisterUtility(registry, utilityConfig, null);
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
				// `optional: true` declara que la ausencia del servicio es un escenario previsto
				// (el consumidor lo resuelve con `tryGetMyService`, que devuelve undefined), así
				// que una integración opcional caída no aborta al padre ni con `failOnError: true`.
				// Misma semántica que `#shouldSkipOptionalProvider` y el grafo de dependencias
				// (`DependencyGraph.#addReverse`).
				const fatal = modulesConfig.failOnError && !serviceConfig.optional;
				ModuleLoader.#failOrWarn(fatal, `Error cargando service ${serviceConfig.name}`, error);
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

		// Single-flight por NOMBRE de servicio, no por uniqueKey: el sistema ya sostiene una
		// instancia por nombre (ver el reuso de más abajo), y es lo que impide que dos apps
		// cargando en paralelo construyan el mismo servicio —con sus providers— por duplicado.
		await this.#loadOnce(`service|${serviceConfig.name}`, async () => {
			if (registry.hasModule("service", serviceConfig.name, serviceUniqueConfig)) {
				Logger.debug(`[ModuleLoader] Servicio ${serviceConfig.name} ya existe, reutilizando instancia`);
				return;
			}

			// Reutilizar instancia kernel-mode (registrada con su propio uniqueKey) si existe
			if (registry.getUniqueKeysByName("service", serviceConfig.name).length > 0) {
				Logger.debug(`[ModuleLoader] Servicio ${serviceConfig.name} ya cargado (kernel-mode u otro), reutilizando`);
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
		});

		// Fuera del single-flight: cada app que declaró el servicio suma su referencia, la haya
		// construido ella o la que ganó la carrera (`addModuleDependency` es idempotente).
		if (registry.hasModule("service", serviceConfig.name, serviceUniqueConfig)) {
			registry.addModuleDependency("service", serviceConfig.name, serviceUniqueConfig);
		} else {
			registry.addModuleDependency("service", serviceConfig.name);
		}
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
			const keyConfig = moduleKeyConfig(config);
			try {
				await this.#loadOnce(`provider|${registry.getUniqueKey(config.name, keyConfig)}`, async () => {
					if (registry.hasModule("provider", config.name, keyConfig)) {
						Logger.debug(`[ModuleLoader] Provider ${config.name} ya existe, reutilizando`);
						return;
					}
					const provider = await this.loadProvider(config, serviceEnvVars);
					this.#registerProviderBothNames(registry, provider, config);
				});
				// Fuera del single-flight: el que espera tiene su PROPIO contexto de carga, así
				// que su app también tiene que quedar anotada como dependiente (es idempotente).
				registry.addModuleDependency("provider", config.name, keyConfig);
			} catch (error) {
				ModuleLoader.#failOrWarn(
					modulesConfig.failOnError,
					`Error cargando provider ${config.name} del servicio ${serviceName}`,
					error
				);
			}
		}
	}

	/**
	 * Nombre bajo el que quedó registrada la utility de cada ruta ya cargada. Se consulta
	 * contra el registry antes de confiar en él: tras un restart o un hot-reload la instancia
	 * ya no está y hay que volver a construirla.
	 */
	readonly #loadedUtilityNames = new Map<string, string>();

	/**
	 * Ruta en disco de la utility, para identificarla ANTES de construirla.
	 *
	 * La deduplicación va por ruta y no por nombre a propósito: el nombre bajo el que una
	 * utility se registra es el que su clase se auto-declara, así que dos utilities DISTINTAS
	 * de presets distintos pueden reclamar el mismo. Deduplicando por nombre, la segunda no se
	 * cargaría nunca y sus consumidores recibirían la ajena en silencio; por ruta, ambas se
	 * cargan y la colisión sigue saliendo como warning del registry, que es lo que hay que ver.
	 */
	async #resolveUtilityPath(config: IModuleConfig): Promise<string | null> {
		const resolved = await VersionResolver.resolveModuleVersion(
			this.#utilitiesPath,
			config.name,
			config.version || "latest",
			config.language || "typescript"
		);
		return resolved?.path ?? null;
	}

	/**
	 * Carga la utility —o reutiliza la que ya esté registrada— y la registra con su alias.
	 * Devuelve el nombre bajo el que quedó, que es el que entiende `addModuleDependency`.
	 *
	 * Punto de entrada ÚNICO a propósito (lo usan los dos caminos de acá abajo y
	 * `BaseModule.#loadUtilities`): sin deduplicación central, una utility declarada por N
	 * servicios se construye N veces y el registry descarta las sobrantes DESPUÉS de que ya
	 * corrieron `start()`, dejándolas iniciadas y sin dueño (nadie les llama `stop()`).
	 */
	async loadAndRegisterUtility(registry: ModuleRegistry, config: IModuleConfig, appName?: string | null): Promise<string> {
		const keyConfig = moduleKeyConfig(config);
		const dedupKey = (await this.#resolveUtilityPath(config)) ?? config.name;
		await this.#loadOnce(`utility|${registry.getUniqueKey(dedupKey, keyConfig)}`, async () => {
			const known = this.#loadedUtilityNames.get(dedupKey);
			// Se reutiliza sólo si la instancia SIGUE registrada: tras un restart desde el
			// panel o un hot-reload, el registry la sacó y hay que volver a construirla.
			if (known && registry.getUniqueKeysByName("utility", known).length > 0) {
				Logger.debug(`[ModuleLoader] Utility ${config.name} ya cargada, reutilizando`);
				return;
			}
			const utility = await this.loadUtility(config);
			this.#registerUtilityWithAlias(registry, utility, config, appName);
			this.#loadedUtilityNames.set(dedupKey, utility.name);
		});
		return this.#loadedUtilityNames.get(dedupKey) ?? config.name;
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
				const registeredName = await this.loadAndRegisterUtility(registry, utilityConfig);
				// Fuera del single-flight: el que espera tiene su PROPIO contexto de carga, así
				// que su app también tiene que quedar anotada como dependiente (es idempotente).
				// Sin esto el refCount se queda en 1 y la primera app que se descargue le hace
				// `stop()` a una utility que las demás siguen usando.
				registry.addModuleDependency("utility", registeredName, moduleKeyConfig(utilityConfig));
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
			registry.addModuleDependency("provider", config.name, moduleKeyConfig(config));
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
		runDevCleanup(instance, `service ${serviceName}`);

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
			const keyConfig = moduleKeyConfig(providerConfig);
			await this.#loadOnce(`provider|${registry.getUniqueKey(providerConfig.name, keyConfig)}`, async () => {
				if (registry.hasModule("provider", providerConfig.name, keyConfig)) {
					Logger.debug(`[ModuleLoader] Provider ${providerConfig.name} ya existe`);
					return;
				}
				const provider = await this.loadProvider(providerConfig, serviceEnvVars);
				this.#registerProviderBothNames(registry, provider, providerConfig, null);
			});
		}
	}
}
