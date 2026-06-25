import "./utils/env/load-env.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Logger } from "./utils/logger/Logger.js";
import { ModuleLoader } from "./utils/loaders/ModuleLoader.js";
import { ModuleRegistry, type ModuleType } from "./utils/registry/ModuleRegistry.js";
import { ReadonlyModuleRegistry } from "./utils/registry/ReadonlyModuleRegistry.ts";
import { Scope, assertScope, CapabilityIssuer, type Capability, type CapabilityToken } from "./common/security/Capability.ts";
import { policyScopes, INFRA_CAP_SCOPES, type ModuleKind } from "./core/security/capabilityPolicy.ts";

/** Superficie que el kernel usa para inyectar capabilities en un módulo recién construido. */
interface ProvisionableModule {
	setKernelKey(key: symbol): void;
	setCapability?(cap: Capability): void;
	setInfraToken?(token: Capability | symbol): void;
}
import { ILogger } from "./interfaces/utils/ILogger.js";
import { DockerManager } from "./utils/system/DockerManager.ts";
import { AppLoader } from "./core/apps/AppLoader.js";
import { ModuleRegistrar } from "./core/modules/ModuleRegistrar.js";
import { KernelServiceLoader } from "./core/services/KernelServiceLoader.js";
import { ConfigWatcher, watchLayer } from "./core/runtime/ConfigWatcher.js";
import { shutdownKernel } from "./core/runtime/KernelShutdown.js";
import { loadLayerRecursive } from "./core/apps/LayerLoader.js";
import { DependencyReloader } from "./core/modules/DependencyReloader.js";
import { DisabledRegistry } from "./core/orchestration/DisabledRegistry.js";
import { ModuleOrchestrator } from "./core/orchestration/ModuleOrchestrator.js";

export class Kernel {
	static readonly #kernelKey: symbol = Symbol(crypto.randomUUID());
	/** Emisor de capabilities por módulo. Privado: ningún módulo puede mintear ni ampliarse scopes. */
	readonly #issuer = new CapabilityIssuer();
	/** Secreto de arranque: lo posee sólo el bootstrap (`index.ts`), nunca un módulo. */
	#bootToken?: symbol;
	#isStartingUp = true;
	#isShuttingDown = false;
	readonly #logger: ILogger = Logger.getLogger("Kernel");

	readonly #registry = new ModuleRegistry(Kernel.#kernelKey);
	readonly #readonlyRegistry = new ReadonlyModuleRegistry(this.#registry);
	readonly #dockerManager = new DockerManager();

	#statusInterval: NodeJS.Timeout | null = null;

	static readonly #moduleLoader = new ModuleLoader(Kernel.#kernelKey);

	readonly #isDevelopment = process.env.NODE_ENV === "development";
	readonly #basePath = path.resolve(process.cwd(), "src");
	readonly #fileExtension = ".ts";

	readonly #providersPath = path.resolve(this.#basePath, "providers");
	readonly #utilitiesPath = path.resolve(this.#basePath, "utilities");
	readonly #servicesPath = path.resolve(this.#basePath, "services");
	readonly #appsPath = path.resolve(this.#basePath, "apps");

	/**
	 * Carpeta raíz de presets opcionales. Cada subcarpeta es un "preset" temático
	 * (ej. `presets/SEO/`) que replica la estructura de `src` (apps, services,
	 * providers, utilities). Permite desacoplar módulos en repos independientes:
	 * si el preset está presente se monta como módulos nativos, si no, el
	 * sistema arranca igual.
	 */
	readonly #presetsPath = path.resolve(process.cwd(), "presets");
	#presetTopics: string[] = [];

	readonly #appLoader: AppLoader;
	readonly #registrar: ModuleRegistrar;
	readonly #kernelServiceLoader: KernelServiceLoader;
	readonly #dependencyReloader: DependencyReloader;
	readonly #disabledRegistry = new DisabledRegistry();
	readonly #orchestrator: ModuleOrchestrator;

	constructor() {
		const isShuttingDown = () => this.#isShuttingDown;
		this.#appLoader = new AppLoader(this, this.#registry, this.#dockerManager, this.#logger, Kernel.#kernelKey, isShuttingDown);
		this.#registrar = new ModuleRegistrar(this, this.#registry, Kernel.#moduleLoader, this.#logger, isShuttingDown);
		this.#kernelServiceLoader = new KernelServiceLoader(
			this,
			this.#registry,
			Kernel.#moduleLoader,
			this.#dockerManager,
			this.#logger,
			Kernel.#kernelKey,
			isShuttingDown,
			this.#disabledRegistry
		);
		this.#dependencyReloader = new DependencyReloader(this.#registry, this.#registrar, this.#appLoader, this.#logger, Kernel.#kernelKey);
		this.#orchestrator = new ModuleOrchestrator({
			registry: this.#registry,
			appLoader: this.#appLoader,
			registrar: this.#registrar,
			dependencyReloader: this.#dependencyReloader,
			disabledRegistry: this.#disabledRegistry,
			logger: this.#logger,
			kernelKey: Kernel.#kernelKey,
			presetsPath: this.#presetsPath,
			srcPath: this.#basePath,
		});
	}

	/**
	 * Devuelve el orquestador de módulos. Requiere `kernelKey` válido: sólo código
	 * privilegiado (p.ej. el preset `adc-modules-manager`, que captura la kernelKey en
	 * su `start()`) puede obtenerlo. No expone el símbolo.
	 */
	public getOrchestrator(token: CapabilityToken): ModuleOrchestrator {
		assertScope(token, Scope.Orchestrator, Kernel.#kernelKey);
		return this.#orchestrator;
	}

	/**
	 * Vista **sólo‑lectura** del registry para resolver services/providers por nombre.
	 * Sin gating por capability a propósito: la lógica de negocio de los módulos la
	 * necesita desde su constructor (antes de recibir su token), y la frontera de
	 * seguridad está en *mutar* (`getMutableRegistry`), *cargar* (`getModuleLoader`),
	 * *orquestar* (`getOrchestrator`) y las superficies `_internal` —no en resolver.
	 * La instancia mutable del registry sigue siendo privada.
	 */
	public getReadonlyRegistry(): ReadonlyModuleRegistry {
		return this.#readonlyRegistry;
	}

	/**
	 * Registry **mutable** (registrar/descargar módulos). Requiere `RegistryWrite`:
	 * sólo la capability de infraestructura de los loaders/clases base (durante la
	 * transición, la master key). Nunca se entrega a la lógica de negocio.
	 */
	public getMutableRegistry(cap: CapabilityToken): ModuleRegistry {
		assertScope(cap, Scope.RegistryWrite, Kernel.#kernelKey);
		return this.#registry;
	}

	/**
	 * Loader de módulos (cargar/instanciar código, leer `.env`). Requiere `ModuleLoader`:
	 * sólo la capability de infraestructura (durante la transición, la master key).
	 */
	public static getModuleLoader(cap: CapabilityToken): ModuleLoader {
		assertScope(cap, Scope.ModuleLoader, Kernel.#kernelKey);
		return Kernel.#moduleLoader;
	}

	/**
	 * Provisiona un módulo recién construido por un loader: mintea su **businessCap**
	 * (scopes según política de su tier + privilegios declarados) y su **infraCap**
	 * (registrar/cargar sub‑dependencias), y se las inyecta. Gateado por la master key:
	 * sólo los loaders del kernel lo invocan. Un módulo no puede auto‑provisionarse con
	 * más scopes: no conoce su `path`/`kind` reales ni la master key, y los setters son
	 * idempotentes.
	 */
	public provisionModule(masterToken: symbol, instance: ProvisionableModule, opts: { name: string; kind: ModuleKind; path: string; declared?: string[] }): void {
		if (masterToken !== Kernel.#kernelKey) {
			this.#logger.logError("provisionModule: token inválido. Llamada rechazada.");
			throw new Error("Invalid kernelKey");
		}
		// Liga la kernelKey para `@OnlyKernel` (transición) y mintea/inyecta las capabilities.
		instance.setKernelKey(masterToken);
		const businessCap = this.#issuer.mint(opts.name, opts.kind, policyScopes(opts));
		const infraCap = this.#issuer.mint(opts.name, "infra", INFRA_CAP_SCOPES);
		instance.setCapability?.(businessCap);
		instance.setInfraToken?.(infraCap);
	}

	public async start(bootToken: symbol): Promise<void> {
		if (this.#bootToken) {
			this.#logger.logError("start: el kernel ya fue iniciado. Llamada rechazada.");
			throw new Error("Kernel ya iniciado");
		}
		this.#bootToken = bootToken;
		this.#logger.logInfo("Iniciando...");
		this.#logger.logInfo(`Modo: ${this.#isDevelopment ? "DESARROLLO" : "PRODUCCIÓN"}`);
		this.#logger.logDebug(`Base path: ${this.#basePath}`);

		this.#presetTopics = await this.#discoverPresetTopics();
		if (this.#presetTopics.length > 0) {
			this.#logger.logInfo(`Presets detectados: ${this.#presetTopics.join(", ")}`);
		}
		Kernel.#moduleLoader.setPresetTopics(this.#presetTopics);

		await this.#dockerManager.loadCommonDockerCompose(path.resolve(this.#basePath, "common", "docker"));
		await this.#kernelServiceLoader.loadAll([this.#servicesPath, ...this.#presetLayerPaths("services")]);

		const excludeTests = process.env.ENABLE_TESTS !== "true" && !this.#isDevelopment;
		const excludeList = excludeTests ? ["BaseApp.ts", "AppWithSeo.ts", "test"] : ["BaseApp.ts", "AppWithSeo.ts"];
		await loadLayerRecursive(
			this.#appsPath,
			this.#appLoader.loadApp,
			excludeList,
			this.#fileExtension,
			this.#logger,
			() => this.#isShuttingDown
		);
		for (const presetAppsPath of this.#presetLayerPaths("apps")) {
			await loadLayerRecursive(
				presetAppsPath,
				this.#appLoader.loadApp,
				excludeList,
				this.#fileExtension,
				this.#logger,
				() => this.#isShuttingDown
			);
		}

		this.#startWatchers();
		await this.#refreshUiImportMaps();
		this.#scheduleStartupReady();
		this.#scheduleStatusInterval();
	}

	async #discoverPresetTopics(): Promise<string[]> {
		try {
			const entries = await fs.readdir(this.#presetsPath, { withFileTypes: true });
			return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
		} catch {
			return [];
		}
	}

	#presetLayerPaths(layer: "apps" | "services" | "providers" | "utilities"): string[] {
		return this.#presetTopics.map((topic) => path.resolve(this.#presetsPath, topic, layer));
	}

	#startWatchers(): void {
		const isStartingUp = () => this.#isStartingUp;
		const unload = (type: ModuleType) => (p: string) => this.#registry.unloadModule(type, Kernel.#kernelKey, p);
		const onChange = (type: ModuleType) => (p: string) => this.#dependencyReloader.handleFileChange(type, p);

		const providerPaths = [this.#providersPath, ...this.#presetLayerPaths("providers")];
		const utilityPaths = [this.#utilitiesPath, ...this.#presetLayerPaths("utilities")];
		const servicePaths = [this.#servicesPath, ...this.#presetLayerPaths("services")];
		const appPaths = [this.#appsPath, ...this.#presetLayerPaths("apps")];

		for (const p of providerPaths) {
			watchLayer(
				p,
				this.#fileExtension,
				(q) => this.#registrar.registerByPath("provider", q),
				unload("provider"),
				isStartingUp,
				[],
				onChange("provider")
			);
		}
		for (const p of utilityPaths) {
			watchLayer(
				p,
				this.#fileExtension,
				(q) => this.#registrar.registerByPath("utility", q),
				unload("utility"),
				isStartingUp,
				[],
				onChange("utility")
			);
		}
		for (const p of servicePaths) {
			watchLayer(
				p,
				this.#fileExtension,
				(q) => this.#registrar.registerByPath("service", q),
				unload("service"),
				isStartingUp,
				[],
				onChange("service")
			);
		}
		for (const p of appPaths) {
			watchLayer(p, this.#fileExtension, this.#appLoader.loadApp, this.#appLoader.unloadApp, isStartingUp, [
				"BaseApp.ts",
				"AppWithSeo.ts",
			]);
		}

		new ConfigWatcher({
			logger: this.#logger,
			registry: this.#registry,
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
			const uiFederation = this.#registry.getService<import("./services/core/UIFederationService/index.ts").default>("UIFederationService");
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
			const stats = this.#registry.getModuleStats();
			this.#logger.logInfo(`Providers: ${stats.providers} - Utilities: ${stats.utilities} - Services: ${stats.services}`);
			const kernelState = {
				...this.#registry.getStateSnapshot(),
				appFiles: Object.fromEntries(this.#appLoader.appFilePaths),
				appConfigFiles: Object.fromEntries(this.#appLoader.appConfigFilePaths),
			};
			this.#logger.logDebug("Kernel State Dump:", JSON.stringify(kernelState, null, 2));
		}, 30000);
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

	public async stop(bootToken: symbol): Promise<void> {
		if (bootToken !== this.#bootToken) {
			this.#logger.logError("stop: bootToken inválido. Llamada rechazada.");
			throw new Error("Invalid bootToken");
		}
		this.#isShuttingDown = true;
		this.#logger.logInfo("\nIniciando cierre ordenado...");
		if (this.#statusInterval) clearInterval(this.#statusInterval);
		await shutdownKernel({
			logger: this.#logger,
			registry: this.#registry,
			dockerManager: this.#dockerManager,
			kernelKey: Kernel.#kernelKey,
		});
	}
}
