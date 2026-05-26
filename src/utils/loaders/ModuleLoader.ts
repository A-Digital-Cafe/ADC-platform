import * as path from "node:path";
import { promises as fs } from "node:fs";
import { LoaderManager } from "./LoaderManager.js";
import { IModuleConfig } from "../../interfaces/modules/IModule.js";
import type { BaseProvider } from "../../providers/BaseProvider.ts";
import type { IUtility } from "../../utilities/BaseUtility.ts";
import type { BaseService } from "../../services/BaseService.ts";
import { Kernel } from "../../kernel.js";
import { Logger } from "../logger/Logger.js";
import { VersionResolver } from "../VersionResolver.js";

export class ModuleLoader {
	readonly #basePath = path.resolve(process.cwd(), "src");

	readonly #providersPath = path.resolve(this.#basePath, "providers");
	readonly #utilitiesPath = path.resolve(this.#basePath, "utilities");
	readonly #servicesPath = path.resolve(this.#basePath, "services");

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
	 * Carga todos los módulos (providers, utilities, services) desde un objeto de definición de módulos.
	 * Usa el contexto de carga del kernel para reference counting.
	 * @param modulesConfig - El objeto de definición de módulos.
	 * @param kernel - La instancia del kernel.
	 */
	async loadAllModulesFromDefinition(modulesConfig: IModuleConfig, kernel: Kernel): Promise<void> {
		try {
			// Cargar providers globales (NO se registran como dependencias de la app)
			// Solo se registran como dependencias cuando un servicio los usa
			if (modulesConfig.providers && Array.isArray(modulesConfig.providers)) {
				for (const providerConfig of modulesConfig.providers) {
					const interpolatedProviderConfig = this.interpolateEnvVars(providerConfig);
					if (ModuleLoader.#shouldSkipOptionalProvider(interpolatedProviderConfig)) {
						Logger.debug(`[ModuleLoader] Provider opcional ${interpolatedProviderConfig.name} omitido (uri vacía)`);
						continue;
					}

					// Verificar si el provider ya existe antes de cargarlo
					if (kernel.registry.hasModule("provider", interpolatedProviderConfig.name, interpolatedProviderConfig.config)) {
						Logger.debug(`[ModuleLoader] Provider global ${interpolatedProviderConfig.name} ya existe, saltando`);
						continue;
					}
					try {
						const provider = await this.loadProvider(interpolatedProviderConfig);
						// Pasar null como appName para que NO se registre como dependencia de la app actual
						// Registrar por el nombre de la clase del provider
						kernel.registry.registerProvider(provider.name, provider, interpolatedProviderConfig, null);

						// También registrar por el nombre del módulo/configuración para que sea encontrable
						if (interpolatedProviderConfig.name !== provider.name) {
							kernel.registry.registerProvider(interpolatedProviderConfig.name, provider, interpolatedProviderConfig, null);
						}
					} catch (error) {
						const message = `Error cargando provider ${providerConfig.name}`;
						if (modulesConfig.failOnError) throw new Error(message, { cause: error });
						Logger.warn(message);
					}
				}
			}

			// Cargar utilities globales (NO se registran como dependencias de la app)
			if (modulesConfig.utilities && Array.isArray(modulesConfig.utilities)) {
				for (const utilityConfig of modulesConfig.utilities) {
					try {
						const utility = await this.loadUtility(utilityConfig);
						// Pasar null como appName para que NO se registre como dependencia de la app actual
						kernel.registry.registerUtility(utility.name, utility, utilityConfig, null);

						// Si el nombre contiene "/", también registrar con el nombre base como alias
						if (utilityConfig.name.includes("/")) {
							const baseName = utilityConfig.name.split("/").pop()!;
							kernel.registry.registerUtility(baseName, utility, utilityConfig, null);
						}
					} catch (error) {
						const message = `Error cargando utility ${utilityConfig.name}`;
						if (modulesConfig.failOnError) throw new Error(message, { cause: error });
						Logger.warn(message);
					}
				}
			}

			// Cargar services
			if (modulesConfig.services && Array.isArray(modulesConfig.services)) {
				for (const serviceConfig of modulesConfig.services) {
					try {
						// Clonar la configuración para poder mutarla, ya que el original está congelado
						const mutableServiceConfig = structuredClone(serviceConfig);

						// PASO 0: Cargar las variables de entorno del servicio primero
						let serviceEnvVars: Record<string, string> = {};
						try {
							const resolved = await VersionResolver.resolveModuleVersion(
								this.#servicesPath,
								serviceConfig.name,
								serviceConfig.version,
								serviceConfig.language
							);
							if (resolved) {
								// resolved.path ya es el directorio del servicio
								const envPath = path.join(resolved.path, ".env");
								Logger.debug(`[ModuleLoader] Intentando cargar .env del servicio desde: ${envPath}`);
								serviceEnvVars = await this.loadEnvFile(envPath);
								Logger.debug(
									`[ModuleLoader] Variables del servicio ${serviceConfig.name}: ${JSON.stringify(Object.keys(serviceEnvVars))}`
								);
							}
						} catch (error) {
							Logger.warn(`[ModuleLoader] Error cargando variables de entorno del servicio ${serviceConfig.name}: ${error}`);
						}

						// PRIMERO: Calcular el uniqueKey para verificar si el servicio ya existe
						// Necesitamos resolver los providers para construir el config correcto
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
									const configJsonPath = path.join(resolved.path, "config.json");
									const configContent = await fs.readFile(configJsonPath, "utf-8");
									const configJson = JSON.parse(configContent);
									if (configJson.providers && Array.isArray(configJson.providers)) {
										finalProviders = configJson.providers;
									}
								}
							} catch {
								// Si no se puede leer, usar el array vacío
							}
						}

						// Interpolar las configuraciones de los providers con las variables del servicio
						if (finalProviders) {
							finalProviders = this.interpolateEnvVars(finalProviders, serviceEnvVars);
						}

						// Construir el config que se usará para el uniqueKey
						const serviceUniqueConfig = {
							...serviceConfig.config,
							__providers: finalProviders,
						};

						// VERIFICAR si el servicio ya existe antes de cargarlo
						if (kernel.registry.hasModule("service", serviceConfig.name, serviceUniqueConfig)) {
							Logger.debug(`[ModuleLoader] Servicio ${serviceConfig.name} ya existe, reutilizando instancia`);
							// Solo agregar la dependencia a la app actual (el kernel lo maneja internamente)
							kernel.registry.addModuleDependency("service", serviceConfig.name, serviceUniqueConfig);
							continue; // Saltar al siguiente servicio
						}

						// Reutilizar instancia kernel-mode (registrada con su propio uniqueKey) si existe
						const existingKeys = kernel.registry.getUniqueKeysByName("service", serviceConfig.name);
						if (existingKeys.length > 0) {
							Logger.debug(`[ModuleLoader] Servicio ${serviceConfig.name} ya cargado (kernel-mode u otro), reutilizando`);
							kernel.registry.addModuleDependency("service", serviceConfig.name);
							continue;
						}

						// SEGUNDO: Cargar los providers específicos del servicio (si los tiene)
						// Esto evita duplicación porque los providers se cargan una sola vez en el kernel
						if (mutableServiceConfig.providers && Array.isArray(mutableServiceConfig.providers)) {
							for (const providerConfig of mutableServiceConfig.providers) {
								// Solo cargar si no es global (los globales ya fueron cargados)
								if (!providerConfig.global) {
									Logger.debug(`[ModuleLoader] Provider config ANTES de interpolar: ${JSON.stringify(providerConfig)}`);
									Logger.debug(`[ModuleLoader] Variables disponibles para interpolación: ${JSON.stringify(serviceEnvVars)}`);

									// Interpolar la configuración del provider con las variables del servicio
									const interpolatedProviderConfig = this.interpolateEnvVars(providerConfig, serviceEnvVars);
									Logger.debug(
										`[ModuleLoader] Provider config DESPUÉS de interpolar: ${JSON.stringify(interpolatedProviderConfig)}`
									);

									if (ModuleLoader.#shouldSkipOptionalProvider(interpolatedProviderConfig)) {
										Logger.debug(`[ModuleLoader] Provider opcional ${interpolatedProviderConfig.name} omitido (uri vacía)`);
										continue;
									}

									// Verificar si el provider ya existe
									if (
										kernel.registry.hasModule("provider", interpolatedProviderConfig.name, interpolatedProviderConfig.config)
									) {
										Logger.debug(`[ModuleLoader] Provider ${interpolatedProviderConfig.name} ya existe, reutilizando`);
										kernel.registry.addModuleDependency(
											"provider",
											interpolatedProviderConfig.name,
											interpolatedProviderConfig.config
										);
										continue;
									}
									try {
										// Pasar las variables del servicio al cargar el provider
										const provider = await this.loadProvider(interpolatedProviderConfig, serviceEnvVars);
										kernel.registry.registerProvider(provider.name, provider, interpolatedProviderConfig);

										// También registrar por el nombre del módulo/configuración
										if (interpolatedProviderConfig.name !== provider.name) {
											kernel.registry.registerProvider(
												interpolatedProviderConfig.name,
												provider,
												interpolatedProviderConfig
											);
										}
									} catch (error) {
										const message = `Error cargando provider ${interpolatedProviderConfig.name} del servicio ${serviceConfig.name}`;
										if (modulesConfig.failOnError) throw new Error(message, { cause: error });
										Logger.warn(message);
									}
								}
							}
						}

						// Cargar utilities específicas del servicio (si las tiene)
						if (mutableServiceConfig.utilities && Array.isArray(mutableServiceConfig.utilities)) {
							Logger.debug(
								`[ModuleLoader] Cargando ${mutableServiceConfig.utilities.length} utilities para servicio ${serviceConfig.name}`
							);
							for (const utilityConfig of mutableServiceConfig.utilities) {
								Logger.debug(`[ModuleLoader] Utility '${utilityConfig.name}' - global: ${utilityConfig.global}`);
								if (utilityConfig.global) {
									Logger.debug(`[ModuleLoader] Saltando utility global: ${utilityConfig.name}`);
								} else {
									try {
										const utility = await this.loadUtility(utilityConfig);
										kernel.registry.registerUtility(utility.name, utility, utilityConfig);

										// Si el nombre contiene "/", también registrar con el nombre base como alias
										if (utilityConfig.name.includes("/")) {
											const baseName = utilityConfig.name.split("/").pop()!;
											Logger.debug(`[ModuleLoader] Registrando alias '${baseName}' para utility '${utilityConfig.name}'`);
											kernel.registry.registerUtility(baseName, utility, utilityConfig);
										}
									} catch (error) {
										const message = `Error cargando utility ${utilityConfig.name} del servicio ${serviceConfig.name}`;
										if (modulesConfig.failOnError) throw new Error(message, { cause: error });
										Logger.warn(message);
									}
								}
							}
						}

						// TERCERO: Cargar el servicio (que ahora puede acceder a sus providers del kernel)
						const service = await this.loadService(mutableServiceConfig, kernel);

						// CUARTO: Registrar los providers del servicio como dependencias de la app
						// Esto es necesario para el reference counting correcto
						if (mutableServiceConfig.providers && Array.isArray(mutableServiceConfig.providers)) {
							for (const providerConfig of mutableServiceConfig.providers) {
								const interpolatedProviderConfig = this.interpolateEnvVars(providerConfig, serviceEnvVars);
								if (ModuleLoader.#shouldSkipOptionalProvider(interpolatedProviderConfig)) continue;

								// Agregar el provider como dependencia de la app actual
								// Esto incrementa el reference count y lo añade a appModuleDependencies
								// addModuleDependency también maneja automáticamente los aliases (type)
								kernel.registry.addModuleDependency(
									"provider",
									interpolatedProviderConfig.name,
									interpolatedProviderConfig.config
								);
							}
						}

						// QUINTO: Registrar el servicio con el config que incluye providers
						const registrationConfig: IModuleConfig = {
							name: serviceConfig.name,
							version: serviceConfig.version,
							language: serviceConfig.language,
							config: serviceUniqueConfig,
						};
						kernel.registry.registerService(service.name, service, registrationConfig);
					} catch (error) {
						const message = `Error cargando service ${serviceConfig.name}`;
						if (modulesConfig.failOnError) throw new Error(message, { cause: error });
						Logger.warn(message);
					}
				}
			}
		} catch (error) {
			const message = `Error procesando la definición de módulos`;
			Logger.error(message);
			throw new Error(message, { cause: error });
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
		const serviceDir = path.dirname(servicePath);
		const serviceName = path.basename(serviceDir);

		const envPath = path.join(serviceDir, ".env");
		const serviceEnvVars = await this.loadEnvFile(envPath);

		const configContent = await fs.readFile(configPath, "utf-8");
		const rawConfig = JSON.parse(configContent);
		const serviceConfig = this.interpolateEnvVars(rawConfig, serviceEnvVars);

		if (serviceConfig.providers && Array.isArray(serviceConfig.providers)) {
			for (const providerConfig of serviceConfig.providers) {
				if (ModuleLoader.#shouldSkipOptionalProvider(providerConfig)) {
					Logger.debug(`[ModuleLoader] Provider opcional ${providerConfig.name} omitido (uri vacía)`);
					continue;
				}

				if (kernel.registry.hasModule("provider", providerConfig.name, providerConfig.config)) {
					Logger.debug(`[ModuleLoader] Provider ${providerConfig.name} ya existe`);
					continue;
				}
				const provider = await this.loadProvider(providerConfig, serviceEnvVars);
				kernel.registry.registerProvider(provider.name, provider, providerConfig, null);
				if (providerConfig.name !== provider.name) {
					kernel.registry.registerProvider(providerConfig.name, provider, providerConfig, null);
				}
			}
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
			__modulePath: serviceDir,
		});
		instance.setKernelKey(kernelKey);
		await instance.start(kernelKey);

		const registrationConfig: IModuleConfig = {
			name: serviceName,
			version: "1.0.0",
			language: "typescript",
			global: true,
			config: { __providers: serviceConfig.providers || [] },
		};

		return { instance, config: registrationConfig };
	}
}
