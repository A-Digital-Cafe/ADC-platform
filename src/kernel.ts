import "./utils/env/load-env.js";
import * as path from "node:path";
import { Logger } from "./utils/logger/Logger.js";
import { ModuleLoader } from "./utils/loaders/ModuleLoader.js";
import { ModuleRegistry, type ModuleType } from "./utils/registry/ModuleRegistry.js";
import { ILogger } from "./interfaces/utils/ILogger.js";
import { DockerManager } from "./utils/system/DockerManager.ts";
import { AppLoader } from "./core/apps/AppLoader.js";
import { ModuleRegistrar } from "./core/modules/ModuleRegistrar.js";
import { KernelServiceLoader } from "./core/services/KernelServiceLoader.js";
import { ConfigWatcher, watchLayer } from "./core/runtime/ConfigWatcher.js";
import { shutdownKernel } from "./core/runtime/KernelShutdown.js";
import { loadLayerRecursive } from "./core/apps/LayerLoader.js";
import { DependencyReloader } from "./core/modules/DependencyReloader.js";

export class Kernel {
	static readonly #kernelKey: symbol = Symbol(crypto.randomUUID());
	#isStartingUp = true;
	#isShuttingDown = false;
	readonly #logger: ILogger = Logger.getLogger("Kernel");

	public readonly registry = new ModuleRegistry(Kernel.#kernelKey);
	readonly #dockerManager = new DockerManager();

	#statusInterval: NodeJS.Timeout | null = null;

	public static readonly moduleLoader = new ModuleLoader(Kernel.#kernelKey);

	readonly #isDevelopment = process.env.NODE_ENV === "development";
	readonly #basePath = path.resolve(process.cwd(), "src");
	readonly #fileExtension = ".ts";

	readonly #providersPath = path.resolve(this.#basePath, "providers");
	readonly #utilitiesPath = path.resolve(this.#basePath, "utilities");
	readonly #servicesPath = path.resolve(this.#basePath, "services");
	readonly #appsPath = path.resolve(this.#basePath, "apps");

	readonly #appLoader: AppLoader;
	readonly #registrar: ModuleRegistrar;
	readonly #kernelServiceLoader: KernelServiceLoader;
	readonly #dependencyReloader: DependencyReloader;

	constructor() {
		const isShuttingDown = () => this.#isShuttingDown;
		this.#appLoader = new AppLoader(this, this.registry, this.#dockerManager, this.#logger, Kernel.#kernelKey, isShuttingDown);
		this.#registrar = new ModuleRegistrar(this, this.registry, Kernel.moduleLoader, this.#logger, isShuttingDown);
		this.#kernelServiceLoader = new KernelServiceLoader(
			this,
			this.registry,
			Kernel.moduleLoader,
			this.#dockerManager,
			this.#logger,
			Kernel.#kernelKey,
			isShuttingDown
		);
		this.#dependencyReloader = new DependencyReloader(this.registry, this.#registrar, this.#appLoader, this.#logger, Kernel.#kernelKey);
	}

	public async start(): Promise<void> {
		this.#logger.logInfo("Iniciando...");
		this.#logger.logInfo(`Modo: ${this.#isDevelopment ? "DESARROLLO" : "PRODUCCIÓN"}`);
		this.#logger.logDebug(`Base path: ${this.#basePath}`);

		await this.#dockerManager.loadCommonDockerCompose(path.resolve(this.#basePath, "common", "docker"));
		await this.#kernelServiceLoader.loadAll(this.#servicesPath);

		const excludeTests = process.env.ENABLE_TESTS !== "true" && !this.#isDevelopment;
		const excludeList = excludeTests ? ["BaseApp.ts", "test"] : ["BaseApp.ts"];
		await loadLayerRecursive(
			this.#appsPath,
			this.#appLoader.loadApp,
			excludeList,
			this.#fileExtension,
			this.#logger,
			() => this.#isShuttingDown
		);

		this.#startWatchers();
		await this.#refreshUiImportMaps();
		this.#scheduleStartupReady();
		this.#scheduleStatusInterval();
	}

	#startWatchers(): void {
		const isStartingUp = () => this.#isStartingUp;
		const unload = (type: ModuleType) => (p: string) => this.registry.unloadModule(type, Kernel.#kernelKey, p);
		const onChange = (type: ModuleType) => (p: string) => this.#dependencyReloader.handleFileChange(type, p);

		watchLayer(
			this.#providersPath,
			this.#fileExtension,
			(p) => this.#registrar.registerByPath("provider", p),
			unload("provider"),
			isStartingUp,
			[],
			onChange("provider")
		);
		watchLayer(
			this.#utilitiesPath,
			this.#fileExtension,
			(p) => this.#registrar.registerByPath("utility", p),
			unload("utility"),
			isStartingUp,
			[],
			onChange("utility")
		);
		watchLayer(
			this.#servicesPath,
			this.#fileExtension,
			(p) => this.#registrar.registerByPath("service", p),
			unload("service"),
			isStartingUp,
			[],
			onChange("service")
		);
		watchLayer(this.#appsPath, this.#fileExtension, this.#appLoader.loadApp, this.#appLoader.unloadApp, isStartingUp, ["BaseApp.ts"]);

		new ConfigWatcher({
			logger: this.#logger,
			registry: this.registry,
			appConfigFilePaths: this.#appLoader.appConfigFilePaths,
			removeConfigPath: (cfg) => this.#appLoader.removeConfigPath(cfg),
			appsPath: this.#appsPath,
			isStartingUp,
			isDevelopment: this.#isDevelopment,
			reloadAppInstance: this.#appLoader.reloadAppInstance,
			loadApp: this.#appLoader.loadApp,
		}).start();
	}

	async #refreshUiImportMaps(): Promise<void> {
		try {
			const uiFederation = this.registry.getService<import("./services/core/UIFederationService/index.ts").default>("UIFederationService");
			if (uiFederation) await uiFederation.refreshAllImportMaps(Kernel.#kernelKey);
			else this.#logger.logWarn("UIFederationService no encontrado");
		} catch (error: any) {
			this.#logger.logError(`Error reinyectando import maps: ${error.message}`);
		}
	}

	#scheduleStartupReady(): void {
		setTimeout(() => {
			this.#isStartingUp = false;
			this.#logger.logInfo("HMR está activo.");
		}, 10000);
	}

	#scheduleStatusInterval(): void {
		this.#statusInterval = setInterval(() => {
			const stats = this.registry.getModuleStats();
			this.#logger.logInfo(`Providers: ${stats.providers} - Utilities: ${stats.utilities} - Services: ${stats.services}`);
			const kernelState = {
				...this.registry.getStateSnapshot(),
				appFiles: Object.fromEntries(this.#appLoader.appFilePaths),
				appConfigFiles: Object.fromEntries(this.#appLoader.appConfigFilePaths),
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
			await this.#registrar.register(type, { name: moduleName, version: versionRange, language });
		} catch (error) {
			this.#logger.logError(`Error cargando ${type} '${moduleName}': ${error}`);
		}
	}

	/**
	 * Recarga un módulo en caliente y cascadea el reload a las apps dependientes.
	 * Requiere `kernelKey` válido: el símbolo privado del Kernel. Pensado para
	 * orquestar updates manuales/automáticos en producción desde código autorizado.
	 */
	public async reloadModule(
		kernelKey: symbol,
		type: ModuleType,
		name: string,
		version: string = "latest",
		language: string = "typescript"
	): Promise<void> {
		if (kernelKey !== Kernel.#kernelKey) {
			this.#logger.logError("reloadModule: kernelKey inválido. Llamada rechazada.");
			throw new Error("Invalid kernelKey");
		}
		await this.#dependencyReloader.reloadByName(type, name, version, language);
	}

	public async stop(): Promise<void> {
		this.#isShuttingDown = true;
		this.#logger.logInfo("\nIniciando cierre ordenado...");
		if (this.#statusInterval) clearInterval(this.#statusInterval);
		await shutdownKernel({
			logger: this.#logger,
			registry: this.registry,
			dockerManager: this.#dockerManager,
			kernelKey: Kernel.#kernelKey,
		});
	}
}
