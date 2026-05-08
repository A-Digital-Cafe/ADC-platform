import "./utils/env/load-env.js";
import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import chokidar from "chokidar";
import { IApp } from "./interfaces/modules/IApp.js";
import { Logger } from "./utils/logger/Logger.js";
import { ModuleLoader } from "./utils/loaders/ModuleLoader.js";
import { ModuleRegistry, type ModuleType, type Module } from "./utils/registry/ModuleRegistry.js";
import { ILogger } from "./interfaces/utils/ILogger.js";
import { IModuleConfig } from "./interfaces/modules/IModule.js";
import type { BaseProvider } from "./providers/BaseProvider.ts";
import type { IUtility } from "./utilities/BaseUtility.ts";
import type { BaseService } from "./services/BaseService.ts";
import { DockerManager } from "./utils/system/DockerManager.ts";

export class Kernel {
	static readonly #kernelKey: symbol = Symbol(crypto.randomUUID());
	#isStartingUp = true;
	#isShuttingDown = false;
	readonly #logger: ILogger = Logger.getLogger("Kernel");

	public readonly registry = new ModuleRegistry(Kernel.#kernelKey);
	readonly #dockerManager = new DockerManager();

	readonly #appFilePaths = new Map<string, string>();
	readonly #appConfigFilePaths = new Map<string, string>();

	#statusInterval: NodeJS.Timeout | null = null;

	public static readonly moduleLoader = new ModuleLoader(Kernel.#kernelKey);

	readonly #isDevelopment = process.env.NODE_ENV === "development";
	readonly #basePath = path.resolve(process.cwd(), "src");
	readonly #fileExtension = ".ts";

	readonly #providersPath = path.resolve(this.#basePath, "providers");
	readonly #utilitiesPath = path.resolve(this.#basePath, "utilities");
	readonly #servicesPath = path.resolve(this.#basePath, "services");
	readonly #appsPath = path.resolve(this.#basePath, "apps");

	async #loadKernelServices(): Promise<void> {
		const kernelServices = await this.#findKernelServices(this.#servicesPath);

		if (kernelServices.length === 0) return;

		this.#logger.logInfo(`Cargando ${kernelServices.length} servicio(s) en modo kernel...`);

		for (const { path: servicePath, name: serviceName, configPath } of kernelServices) {
			if (this.#isShuttingDown) {
				this.#logger.logInfo("Cierre en progreso, abortando carga de servicios kernel...");
				return;
			}
			try {
				const serviceDir = path.dirname(servicePath);

				try {
					await this.#dockerManager.startServiceDockerCompose(serviceDir, serviceName);
				} catch {
					this.#logger.logDebug(`docker-compose no disponible para ${serviceName}`);
				}

				const { instance, config } = await Kernel.moduleLoader.loadKernelService(servicePath, configPath, this, Kernel.#kernelKey);

				this.registry.registerService(serviceName, instance, config);
				this.#logger.logOk(`Servicio kernel cargado: ${serviceName}`);
			} catch (error: any) {
				this.#logger.logError(`Error cargando servicio kernel (${serviceName}): ${error.message}`);
			}
		}
	}

	async #findKernelServices(dir: string): Promise<Array<{ path: string; name: string; configPath: string; priority: number }>> {
		const kernelServices: Array<{ path: string; name: string; configPath: string; priority: number }> = [];

		const traverse = async (currentDir: string) => {
			const entries = await fs.readdir(currentDir, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(currentDir, entry.name);

				if (entry.isDirectory()) {
					const configPath = path.join(fullPath, "config.json");
					try {
						await fs.access(configPath);
						const configContent = await fs.readFile(configPath, "utf-8");
						const config = JSON.parse(configContent);

						const kernelMode = config.kernelMode;
						const priority = kernelMode === true ? 1 : typeof kernelMode === "number" ? kernelMode : null;

						if (priority !== null) {
							const indexTs = path.join(fullPath, "index.ts");
							const indexJs = path.join(fullPath, "index.js");

							try {
								await fs.access(indexTs);
								kernelServices.push({ path: indexTs, name: entry.name, configPath, priority });
								continue;
							} catch {
								try {
									await fs.access(indexJs);
									kernelServices.push({ path: indexJs, name: entry.name, configPath, priority });
									continue;
								} catch {
									/* no index */
								}
							}
						}
					} catch {
						/* no config.json */
					}

					await traverse(fullPath);
				}
			}
		};

		await traverse(dir);
		return kernelServices.sort((a, b) => a.priority - b.priority);
	}

	public async start(): Promise<void> {
		this.#logger.logInfo("Iniciando...");
		this.#logger.logInfo(`Modo: ${this.#isDevelopment ? "DESARROLLO" : "PRODUCCIÓN"}`);
		this.#logger.logDebug(`Base path: ${this.#basePath}`);

		// Cargar contenedores Docker comunes antes de los servicios kernel
		const commonDockerPath = path.resolve(this.#basePath, "common", "docker");
		await this.#dockerManager.loadCommonDockerCompose(commonDockerPath);

		await this.#loadKernelServices();

		const excludeTests = process.env.ENABLE_TESTS !== "true" && !this.#isDevelopment;
		const excludeList = excludeTests ? ["BaseApp.ts", "test"] : ["BaseApp.ts"];
		await this.#loadLayerRecursive(this.#appsPath, this.#loadApp.bind(this), excludeList);

		this.#watchLayer(
			this.#providersPath,
			this.#loadAndRegisterModule.bind(this, "provider"),
			this.registry.unloadModule.bind(this, "provider", Kernel.#kernelKey)
		);
		this.#watchLayer(
			this.#utilitiesPath,
			this.#loadAndRegisterModule.bind(this, "utility"),
			this.registry.unloadModule.bind(this, "utility", Kernel.#kernelKey)
		);
		this.#watchLayer(
			this.#servicesPath,
			this.#loadAndRegisterModule.bind(this, "service"),
			this.registry.unloadModule.bind(this, "service", Kernel.#kernelKey)
		);
		this.#watchLayer(this.#appsPath, this.#loadApp.bind(this), this.#unloadApp.bind(this), ["BaseApp.ts"]);

		this.#watchAppConfigs();

		setTimeout(() => {
			this.#isStartingUp = false;
			this.#logger.logInfo("HMR está activo.");
		}, 10000);

		this.#statusInterval = setInterval(() => {
			const stats = this.registry.getModuleStats();
			this.#logger.logInfo(`Providers: ${stats.providers} - Utilities: ${stats.utilities} - Services: ${stats.services}`);
			const kernelState = {
				...this.registry.getStateSnapshot(),
				appFiles: Object.fromEntries(this.#appFilePaths),
				appConfigFiles: Object.fromEntries(this.#appConfigFilePaths),
			};
			this.#logger.logDebug("Kernel State Dump:", JSON.stringify(kernelState, null, 2));
		}, 30000);
	}

	public async loadModuleOfType(
		type: ModuleType,
		moduleName: string,
		versionRange: string = "latest",
		language: string = "typescript"
	): Promise<void> {
		try {
			const config = { name: moduleName, version: versionRange, language };
			await this.#loadAndRegisterSpecificModule(type, config);
		} catch (error) {
			this.#logger.logError(`Error cargando ${type} '${moduleName}': ${error}`);
		}
	}

	public async stop(): Promise<void> {
		this.#isShuttingDown = true;
		this.#logger.logInfo("\nIniciando cierre ordenado...");
		if (this.#statusInterval) clearInterval(this.#statusInterval);

		const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T | undefined> => {
			const timeoutPromise = new Promise<undefined>((resolve) => {
				setTimeout(() => {
					this.#logger.logWarn(`Timeout deteniendo ${name} (${timeoutMs}ms)`);
					resolve(undefined);
				}, timeoutMs);
			});
			return Promise.race([promise, timeoutPromise]);
		};

		this.#logger.logInfo(`Deteniendo Apps...`);
		for (const [name, instance] of this.registry.getAppsRegistry()) {
			try {
				this.#logger.logDebug(`Deteniendo App ${name}`);
				if (instance.stop) {
					await withTimeout(instance.stop(Kernel.#kernelKey), 3000, `App ${name}`);
				}

				const appBaseName = name.split(":")[0];

				if (this.#dockerManager.hasAppDockerCompose(appBaseName)) {
					const appDir = this.#dockerManager.getAppDockerComposeDir(appBaseName)!;
					try {
						await withTimeout(this.#dockerManager.stopDockerCompose(appDir), 5000, `Docker ${appBaseName}`);
						this.#dockerManager.deleteAppDockerCompose(appBaseName);
					} catch (e) {
						this.#logger.logWarn(`Error deteniendo Docker para App ${appBaseName}: ${e}`);
					}
				}
			} catch (e) {
				this.#logger.logError(`Error deteniendo App ${name}: ${e}`);
			}
		}

		await this.registry.stopAllModules(Kernel.#kernelKey, withTimeout);

		// Detener contenedores Docker comunes al final
		this.#logger.logInfo("Deteniendo contenedores Docker comunes...");
		await withTimeout(this.#dockerManager.stopAllCommonDockerCompose(), 10000, "Docker comunes");

		this.#logger.logOk("Cierre completado.");
	}

	async #loadLayerRecursive(dir: string, loader: (entryPath: string) => Promise<void>, exclude: string[] = []): Promise<void> {
		if (this.#isShuttingDown) return;
		try {
			const indexPath = path.join(dir, `index${this.#fileExtension}`);
			try {
				if ((await fs.stat(indexPath)).isFile()) {
					await loader(indexPath);
					return;
				}
			} catch {
				/* no index */
			}

			const entries = await fs.readdir(dir, { withFileTypes: true });
			const loadLevels = await this.#buildAppLoadLevels(dir, entries, exclude);

			for (const level of loadLevels) {
				if (this.#isShuttingDown) return;
				if (level.length === 1) {
					await this.#loadLayerRecursive(level[0], loader, exclude);
				} else if (level.length > 1) {
					this.#logger.logDebug(`Cargando ${level.length} apps en paralelo...`);
					await Promise.all(level.map((subDirPath) => this.#loadLayerRecursive(subDirPath, loader, exclude)));
				}
			}
		} catch {
			/* dir no existe */
		}
	}

	async #buildAppLoadLevels(dir: string, entries: Dirent[], exclude: string[]): Promise<string[][]> {
		const appConfigs: Array<{
			path: string;
			dirName: string;
			name: string;
			dependencies: string[];
			isUILib: boolean;
			isHost: boolean;
			isRemote: boolean;
		}> = [];

		for (const entry of entries) {
			if (!entry.isDirectory() || exclude.includes(entry.name)) continue;

			const subDirPath = path.join(dir, entry.name);
			const configPath = path.join(subDirPath, "config.json");

			try {
				const configContent = await fs.readFile(configPath, "utf-8");
				const config = JSON.parse(configContent);

				if (config.uiModule) {
					const uiModule = config.uiModule;
					const appName = uiModule.name || entry.name;
					const isUILib = uiModule.framework === "stencil" && uiModule.exports;
					const isHost = uiModule.isHost ?? false;
					const isRemote = uiModule.isRemote ?? false;
					const dependencies = uiModule.uiDependencies || [];

					appConfigs.push({ path: subDirPath, dirName: entry.name, name: appName, dependencies, isUILib, isHost, isRemote });
				} else {
					appConfigs.push({
						path: subDirPath,
						dirName: entry.name,
						name: entry.name,
						dependencies: [],
						isUILib: false,
						isHost: false,
						isRemote: false,
					});
				}
			} catch {
				appConfigs.push({
					path: subDirPath,
					dirName: entry.name,
					name: entry.name,
					dependencies: [],
					isUILib: false,
					isHost: false,
					isRemote: false,
				});
			}
		}

		const levels: string[][] = [];
		const loadedAppNames = new Set<string>();

		const uiLibs = appConfigs.filter((app) => app.isUILib);
		if (uiLibs.length > 0) {
			levels.push(uiLibs.map((app) => app.path));
			uiLibs.forEach((app) => loadedAppNames.add(app.name));
		}

		const hosts = appConfigs.filter((app) => app.isHost && !app.isUILib);
		const others = appConfigs.filter((app) => !app.isUILib && !app.isHost);

		let pendingQueue = [...others];
		const maxIterations = 50;
		let iteration = 0;

		while (pendingQueue.length > 0 && iteration < maxIterations) {
			const currentLevel: string[] = [];
			const stillPending: typeof pendingQueue = [];

			for (const app of pendingQueue) {
				const allDepsLoaded = app.dependencies.every((depName) => loadedAppNames.has(depName));

				if (allDepsLoaded) {
					currentLevel.push(app.path);
					loadedAppNames.add(app.name);
				} else {
					stillPending.push(app);
				}
			}

			if (currentLevel.length > 0) {
				levels.push(currentLevel);
			} else if (stillPending.length > 0) {
				const pendingNames = stillPending.map((app) => app.name).join(", ");
				const missingDeps = stillPending
					.map((app) => {
						const missing = app.dependencies.filter((dep) => !loadedAppNames.has(dep));
						return `${app.name} -> [${missing.join(", ")}]`;
					})
					.join("; ");

				this.#logger.logWarn(`Dependencias circulares o faltantes: ${pendingNames}. Faltantes: ${missingDeps}.`);

				levels.push(stillPending.map((app) => app.path));
				stillPending.forEach((app) => loadedAppNames.add(app.name));
				break;
			}

			pendingQueue = stillPending;
			iteration++;
		}

		if (hosts.length > 0) {
			let pendingHosts = [...hosts];
			let hostIterations = 0;

			while (pendingHosts.length > 0 && hostIterations < 10) {
				const currentHostLevel: string[] = [];
				const stillPendingHosts: typeof pendingHosts = [];

				for (const host of pendingHosts) {
					const allDepsLoaded = host.dependencies.every((depName) => loadedAppNames.has(depName));
					if (allDepsLoaded) {
						currentHostLevel.push(host.path);
						loadedAppNames.add(host.name);
					} else {
						stillPendingHosts.push(host);
					}
				}

				if (currentHostLevel.length > 0) {
					levels.push(currentHostLevel);
				} else {
					levels.push(stillPendingHosts.map((h) => h.path));
					break;
				}

				pendingHosts = stillPendingHosts;
				hostIterations++;
			}
		}

		if (levels.length > 1) {
			this.#logger.logDebug(`Niveles de carga: ${levels.map((l, i) => `L${i}(${l.length})`).join(" -> ")}`);
		}

		return levels;
	}

	async #loadAndRegisterSpecificModule(moduleType: ModuleType, config: IModuleConfig): Promise<Module> {
		let module: Module;

		switch (moduleType) {
			case "provider": {
				const providerModule: BaseProvider = await Kernel.moduleLoader.loadProvider(config);
				this.registry.registerProvider(providerModule.name, providerModule, config);
				module = providerModule;
				break;
			}
			case "utility": {
				const utilityModule: IUtility = await Kernel.moduleLoader.loadUtility(config);
				this.registry.registerUtility(utilityModule.name, utilityModule, config);
				module = utilityModule;
				break;
			}
			case "service": {
				const serviceModule: BaseService = await Kernel.moduleLoader.loadService(config, this);
				this.registry.registerService(serviceModule.name, serviceModule, config);
				module = serviceModule;
				break;
			}
		}
		return module!;
	}

	async #loadAndRegisterModule(moduleType: ModuleType, filePath: string): Promise<void> {
		if (this.#isShuttingDown) {
			this.#logger.logDebug(`Cierre en progreso, ignorando carga de ${moduleType}: ${filePath}`);
			return;
		}
		try {
			const modulePath = path.dirname(filePath);
			let config = Kernel.moduleLoader.getConfigByPath(modulePath);
			if (!config) {
				const moduleName = path.basename(modulePath);
				config = { name: moduleName };
			}

			const module = await this.#loadAndRegisterSpecificModule(moduleType, config);

			const uniqueKey = this.registry.getUniqueKey(module.name, config.custom);
			const fileMap = this.registry.getFileToUniqueKeyMap(moduleType);
			fileMap.set(filePath, uniqueKey);
		} catch (e) {
			const capitalizedModuleType = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);
			this.#logger.logError(`Error cargando ${capitalizedModuleType} ${filePath}: ${e}`);
		}
	}

	#getConfigName(configFile: string): string {
		const configNameRaw = path.basename(configFile, ".json");
		return configNameRaw === "config"
			? "default"
			: configNameRaw.startsWith("config-")
				? configNameRaw.substring("config-".length)
				: configNameRaw;
	}

	async #initializeAndRunApp(app: IApp, filePath: string, instanceName: string, configPath?: string): Promise<void> {
		if (this.#isShuttingDown) {
			this.#logger.logDebug(`Cierre en progreso, no se inicializa app: ${instanceName}`);
			return;
		}
		this.#logger.logInfo(`Inicializando App: ${instanceName} desde ${path.basename(filePath)}`);
		this.registry.registerApp(instanceName, app);
		this.#logger.logDebug(`Inicializando App ${app.name}`);

		this.registry.setLoadingContext(instanceName);
		try {
			await app.loadModulesFromConfig();
			app.setKernelKey(Kernel.#kernelKey);
			await app.start?.(Kernel.#kernelKey);
		} finally {
			this.registry.setLoadingContext(null);
		}

		if (this.#isShuttingDown) {
			this.#logger.logDebug(`Cierre en progreso, no se ejecuta run() para: ${instanceName}`);
			return;
		}

		this.#appFilePaths.set(`${filePath}:${instanceName}`, instanceName);
		if (configPath) {
			this.#appConfigFilePaths.set(configPath, instanceName);
		}
		this.#logger.logDebug(`Ejecutando App ${app.name}`);
		app.run().catch((e) => {
			if (this.#isShuttingDown) return;
			this.#logger.logError(`Error ejecutando App ${app.name}: {}\nSe intentará ejecutarla de nuevo en 30 segundos...`, e.message);
			setTimeout(() => this.#initializeAndRunApp(app, filePath, instanceName, configPath), 30_000);
		});
	}

	async #reloadAppInstance(configPath: string): Promise<void> {
		try {
			const instanceName = this.#appConfigFilePaths.get(configPath);
			if (!instanceName) {
				this.#logger.logWarn(`No se encontró instancia para el archivo de configuración: ${configPath}`);
				return;
			}

			const app = this.registry.hasApp(instanceName) ? this.registry.getApp(instanceName) : null;
			if (app) {
				this.#logger.logInfo(`Recargando instancia de App: ${instanceName}`);
				await app.stop?.();

				await this.registry.cleanupAppModules(instanceName, Kernel.#kernelKey);

				this.registry.deleteApp(instanceName);

				for (const [key, value] of this.#appFilePaths.entries()) {
					if (value === instanceName) {
						this.#appFilePaths.delete(key);
					}
				}
			}

			const appName = instanceName.split(":")[0];
			const appDir = configPath.includes(`${path.sep}configs${path.sep}`)
				? path.dirname(path.dirname(configPath))
				: path.dirname(configPath);
			const appFilePath = path.join(appDir, `index${this.#fileExtension}`);

			const module = await import(`${appFilePath}?v=${Date.now()}`);
			const AppClass = module.default;
			if (!AppClass) {
				this.#logger.logError(`No se pudo cargar la clase de la app: ${appName}`);
				return;
			}

			const config = JSON.parse(await fs.readFile(configPath, "utf-8"));

			const newApp: IApp = new AppClass(this, instanceName, config, appFilePath);
			await this.#initializeAndRunApp(newApp, appFilePath, instanceName, configPath);

			this.#logger.logOk(`Instancia recargada exitosamente: ${instanceName}`);
		} catch (error) {
			this.#logger.logError(`Error recargando instancia desde ${configPath}: ${error}`);
		}
	}

	async #loadApp(filePath: string): Promise<void> {
		if (this.#isShuttingDown) {
			this.#logger.logInfo("Cierre en progreso, abortando carga de app...");
			return;
		}
		try {
			const module = await import(`${filePath}?v=${Date.now()}`);
			const AppClass = module.default;
			if (!AppClass) return;

			const appDir = path.dirname(filePath);
			const appName = path.basename(appDir);

			try {
				const defaultConfigPath = path.join(appDir, "default.json");
				const defaultConfigContent = await fs.readFile(defaultConfigPath, "utf-8");
				const defaultConfig = JSON.parse(defaultConfigContent);

				if (defaultConfig.disabled === true) {
					this.#logger.logDebug(`App ${appName} está deshabilitada (default.json)`);
					return;
				}
			} catch {
				/* no default.json */
			}

			try {
				const configPath = path.join(appDir, "config.json");
				const configContent = await fs.readFile(configPath, "utf-8");
				const config = JSON.parse(configContent);

				if (config.disabled === true) {
					this.#logger.logDebug(`App ${appName} está deshabilitada (config.json)`);
					return;
				}
			} catch {
				/* no config.json */
			}

			try {
				await this.#dockerManager.startDockerCompose(appDir, appName);
			} catch {
				this.#logger.logDebug(`docker-compose no disponible para ${appName}`);
			}

			const configDirs = [appDir, path.join(appDir, "configs")];
			const allConfigFiles: string[] = [];

			for (const dir of configDirs) {
				try {
					const files = await fs
						.readdir(dir)
						.then((files) => files.filter((file) => file.startsWith("config") && file.endsWith(".json")));
					for (const file of files) {
						allConfigFiles.push(path.join(dir, file));
					}
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
						this.#logger.logWarn(`No se pudo leer el directorio de configuración ${dir}: ${error}`);
					}
				}
			}

			if (allConfigFiles.length > 0) {
				for (const configPath of allConfigFiles) {
					const config = JSON.parse(await fs.readFile(configPath, "utf-8"));

					if (config.disabled === true) {
						this.#logger.logDebug(`App ${appName} está deshabilitada (config: ${path.basename(configPath)})`);
						continue;
					}

					const configFile = path.basename(configPath);
					const configName = this.#getConfigName(configFile);
					const instanceName = `${appName}:${configName}`;

					const app: IApp = new AppClass(this, instanceName, config, filePath);
					await this.#initializeAndRunApp(app, filePath, instanceName, configPath);
				}
			} else {
				const app: IApp = new AppClass(this, appName, undefined, filePath);
				await this.#initializeAndRunApp(app, filePath, appName);
			}
		} catch (e: any) {
			if (e.code === "ERR_MODULE_NOT_FOUND") {
				this.#logger.logError(`Faltan dependencias de Node.js para la app en ${filePath}. Reintentando en 30 segundos...`);
				this.#logger.logError(e);
				setTimeout(() => this.#loadApp(filePath), 30000);
			} else {
				this.#logger.logError(`Error ejecutando App ${filePath}: ${e}`);
			}
		}
	}

	#watchAppConfigs() {
		const srcAppsPath = path.resolve(process.cwd(), "src", "apps");
		const patterns = [path.join(srcAppsPath, "**/*.json"), path.join(srcAppsPath, "**/configs/*.json")];

		const watcher = chokidar.watch(patterns, {
			ignoreInitial: true,
			ignored: (filePath) => {
				return ["default.json", "tsonfig.json"].includes(path.basename(filePath));
			},
			awaitWriteFinish: {
				stabilityThreshold: 2000,
				pollInterval: 100,
			},
		});

		watcher.on("change", async (srcConfigPath) => {
			if (this.#isStartingUp) return;
			this.#logger.logInfo(`Detectado cambio en configuración: ${path.basename(srcConfigPath)}`);
			await this.#reloadAppInstance(srcConfigPath);
		});

		watcher.on("add", async (srcConfigPath) => {
			if (this.#isStartingUp) return;

			const appDirResolved = srcConfigPath.includes("/configs/") ? path.dirname(path.dirname(srcConfigPath)) : path.dirname(srcConfigPath);
			const appFilePath = path.join(appDirResolved, `index${this.#fileExtension}`);

			try {
				await fs.stat(appFilePath);
				this.#logger.logInfo(`Nuevo archivo de configuración detectado: ${path.basename(srcConfigPath)}`);
				await this.#loadApp(appFilePath);
			} catch {
				/* app no existe */
			}
		});

		watcher.on("unlink", async (srcConfigPath) => {
			if (this.#isStartingUp) return;

			let targetConfigPath = srcConfigPath;
			if (!this.#isDevelopment) {
				const relativePath = path.relative(srcAppsPath, srcConfigPath);
				targetConfigPath = path.join(this.#appsPath, relativePath);
				try {
					await fs.unlink(targetConfigPath);
				} catch {
					/* archivo no existe */
				}
			}

			const instanceName = this.#appConfigFilePaths.get(targetConfigPath);
			if (instanceName) {
				this.#logger.logInfo(`Archivo de configuración eliminado: ${path.basename(srcConfigPath)}`);
				if (this.registry.hasApp(instanceName)) {
					const app = this.registry.getApp(instanceName);
					await app.stop?.();
					this.registry.deleteApp(instanceName);
				}
				this.#appConfigFilePaths.delete(targetConfigPath);
			}
		});
	}

	#watchLayer(dir: string, loader: (p: string) => Promise<void>, unloader: (p: string) => Promise<void>, exclude: string[] = []) {
		const watcher = chokidar.watch(path.join(dir, `**/index${this.#fileExtension}`), {
			ignoreInitial: true,
			ignored: exclude,
			awaitWriteFinish: {
				stabilityThreshold: 2000,
				pollInterval: 100,
			},
		});
		watcher.on("add", (p) => {
			if (this.#isStartingUp) return;
			loader(p);
		});
		watcher.on("change", async (p) => {
			if (this.#isStartingUp) return;
			await unloader(p);
			await loader(p);
		});
		watcher.on("unlink", (p) => {
			if (this.#isStartingUp) return;
			unloader(p);
		});
	}

	async #unloadApp(filePath: string) {
		const keysToUnload = Array.from(this.#appFilePaths.keys()).filter((key) => key.startsWith(filePath));

		for (const key of keysToUnload) {
			const appName = this.#appFilePaths.get(key);
			if (appName && this.registry.hasApp(appName)) {
				const app = this.registry.getApp(appName);
				this.#logger.logDebug(`Removiendo app: ${app.name}`);
				await app.stop?.();

				await this.registry.cleanupAppModules(appName, Kernel.#kernelKey);

				this.registry.deleteApp(app.name);
				this.#appFilePaths.delete(key);

				for (const [configPath, instanceName] of this.#appConfigFilePaths.entries()) {
					if (instanceName === appName) {
						this.#appConfigFilePaths.delete(configPath);
					}
				}
			}
		}
	}
}
