import "./utils/env/load-env.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Logger } from "./utils/logger/Logger.js";
import { ModuleLoader } from "./utils/loaders/ModuleLoader.js";
import { ModuleRegistry, type ModuleType } from "./utils/registry/ModuleRegistry.js";
import { ReadonlyModuleRegistry } from "./utils/registry/ReadonlyModuleRegistry.ts";
import { Scope, assertScope, CapabilityIssuer, type Capability, type CapabilityToken } from "./common/security/Capability.ts";
import { setLifecycleRoot } from "./utils/decorators/OnlyKernel.ts";
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
import { ConfigWatcher, watchLayer, watchPresetTopic, watchPresetsRoot, type LayerEventHandlers } from "./core/runtime/ConfigWatcher.js";
import { ModuleDetector } from "./core/runtime/ModuleDetector.js";
import { shutdownKernel } from "./core/runtime/KernelShutdown.js";
import { loadLayerRecursive } from "./core/apps/LayerLoader.js";
import { DependencyReloader } from "./core/modules/DependencyReloader.js";
import { DisabledRegistry } from "./core/orchestration/DisabledRegistry.js";
import { ModuleOrchestrator } from "./core/orchestration/ModuleOrchestrator.js";

export class Kernel {
	static readonly #kernelKey: symbol = Symbol(crypto.randomUUID());
	/** Emisor de capabilities por módulo. Privado: ningún módulo puede mintear ni ampliarse scopes. */
	readonly #issuer = new CapabilityIssuer();
	/**
	 * Capability propia del kernel para operaciones de infraestructura de plataforma
	 * (`platform:infra`): la presenta el kernel/orquestador a `refreshAllImportMaps`,
	 * `rebuildModule` y `setOwnerUnavailable`. `platform:infra` es INFRA_ONLY: ningún
	 * módulo puede obtenerla vía `privileges`, así que no puede disparar esas operaciones.
	 */
	readonly #platformCap: Capability = this.#issuer.mint("kernel", "infra", [Scope.PlatformInfra]);
	/**
	 * Capability del kernel para avisar al equipo de seguridad (Admins + Security
	 * Managers globales) cuando un módulo queda en fallo repetido (circuit breaker
	 * abierto), vía `IdentityManagerService.notifications()` (exige `identity:internal`).
	 * La presenta sólo el kernel; nunca se entrega a módulos.
	 */
	readonly #securityNotifyCap: Capability = this.#issuer.mint("kernel", "infra", [Scope.IdentityInternal]);
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
	readonly #detector: ModuleDetector;
	readonly #orchestrator: ModuleOrchestrator;

	constructor() {
		// Raíz de confianza para el stop de ciclo de vida (ver `stopBoundModule`): la master key.
		setLifecycleRoot(Kernel.#kernelKey);
		const isShuttingDown = () => this.#isShuttingDown;
		this.#appLoader = new AppLoader(
			this,
			this.#registry,
			this.#dockerManager,
			this.#logger,
			Kernel.#kernelKey,
			isShuttingDown,
			this.#disabledRegistry,
			(moduleName, error) => this.#notifyModuleFailure(moduleName, error)
		);
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
		this.#detector = new ModuleDetector({
			logger: this.#logger,
			registry: this.#registry,
			appLoader: this.#appLoader,
			disabledRegistry: this.#disabledRegistry,
			presetsPath: this.#presetsPath,
			isShuttingDown,
		});
		this.#detector.onDetected((e) => {
			if (e.kind === "detected") this.#notifyModuleDetected(e);
		});
		this.#orchestrator = new ModuleOrchestrator({
			registry: this.#registry,
			appLoader: this.#appLoader,
			registrar: this.#registrar,
			dependencyReloader: this.#dependencyReloader,
			disabledRegistry: this.#disabledRegistry,
			detector: this.#detector,
			logger: this.#logger,
			kernelKey: Kernel.#kernelKey,
			platformCap: this.#platformCap,
			presetsPath: this.#presetsPath,
			srcPath: this.#basePath,
		});
	}

	/**
	 * Avisa al equipo de seguridad que un módulo agotó sus reintentos rápidos y quedó
	 * en reintento lento (breaker abierto). Va vía `IdentityManagerService.notifications()`
	 * —que resuelve destinatarios (Admins + Security Managers globales) y emite el topic
	 * reservado `security.module_failure`—. Best-effort: sin identity cargado, sólo log.
	 */
	#notifyModuleFailure(moduleName: string, error: string): void {
		interface IdentityNotifier {
			notifications(token: CapabilityToken): { moduleFailure(event: { module: string; error: string }): Promise<void> };
		}
		try {
			const identity = this.#registry.getService<IdentityNotifier>("IdentityManagerService");
			void identity
				.notifications(this.#securityNotifyCap)
				.moduleFailure({ module: moduleName, error })
				.catch((e: unknown) => this.#logger.logDebug(`Alerta de fallo de módulo no emitida: ${e}`));
		} catch {
			this.#logger.logDebug(`Alerta de fallo de módulo no emitida (IdentityManagerService no disponible): ${moduleName}`);
		}
	}

	/**
	 * Avisa al equipo de seguridad que apareció un módulo NUEVO en runtime (quedó
	 * pendiente, sin ejecutar). Mismo canal best-effort que `#notifyModuleFailure`.
	 */
	#notifyModuleDetected(e: { type: string; name: string; filePath: string; preset: string | null }): void {
		interface IdentityNotifier {
			notifications(token: CapabilityToken): {
				moduleDetected(event: { module: string; layer: string; filePath: string; preset: string | null }): Promise<void>;
			};
		}
		try {
			const identity = this.#registry.getService<IdentityNotifier>("IdentityManagerService");
			void identity
				.notifications(this.#securityNotifyCap)
				.moduleDetected({ module: e.name, layer: e.type, filePath: e.filePath, preset: e.preset })
				.catch((err: unknown) => this.#logger.logDebug(`Alerta de módulo detectado no emitida: ${err}`));
		} catch {
			this.#logger.logDebug(`Alerta de módulo detectado no emitida (IdentityManagerService no disponible): ${e.name}`);
		}
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
	public provisionModule(masterToken: symbol, instance: ProvisionableModule, opts: { name: string; kind: ModuleKind; path: string; declared?: string[] }): symbol {
		if (masterToken !== Kernel.#kernelKey) {
			this.#logger.logError("provisionModule: token inválido. Llamada rechazada.");
			throw new Error("Invalid kernelKey");
		}
		// Token de ciclo de vida ÚNICO por instancia para `@OnlyKernel` (start/stop). NO es la
		// master key: el módulo lo recibe en `start()`, pero al no ser la master key no puede
		// escalar (orchestrator/loader/registry mutable siguen exigiéndola) ni actuar por otro
		// módulo. El caller lo usa para `start(token)`; el stop va por `stopBoundModule`.
		const lifecycleToken = Symbol(`lifecycle:${opts.name}`);
		instance.setKernelKey(lifecycleToken);
		const businessCap = this.#issuer.mint(opts.name, opts.kind, policyScopes(opts));
		const infraCap = this.#issuer.mint(opts.name, "infra", INFRA_CAP_SCOPES);
		instance.setCapability?.(businessCap);
		instance.setInfraToken?.(infraCap);
		return lifecycleToken;
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

		// Capas del core (los directorios siempre existen).
		for (const type of ["provider", "utility", "service"] as ModuleType[]) {
			const dir = { provider: this.#providersPath, utility: this.#utilitiesPath, service: this.#servicesPath }[type] as string;
			watchLayer(dir, this.#fileExtension, this.#layerEventHandlers(type), { isStartingUp });
		}
		watchLayer(this.#appsPath, this.#fileExtension, this.#layerEventHandlers("app"), {
			isStartingUp,
			exclude: ["BaseApp.ts", "AppWithSeo.ts"],
		});

		// Presets conocidos al boot: un watcher por topic (cubre capas creadas después).
		for (const topic of this.#presetTopics) {
			watchPresetTopic(path.resolve(this.#presetsPath, topic), this.#fileExtension, (layer) => this.#layerEventHandlers(layer), {
				isStartingUp,
			});
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
			onNewAppConfig: (appFile) => this.#onNewAppConfig(appFile),
			isPendingPath: (p) => this.#disabledRegistry.isPendingPath(p),
		}).start();

		// Presets agregados en runtime: se adoptan (watcher de topic) pero sus módulos
		// quedan PENDIENTES de lanzamiento manual; nada se autoejecuta.
		watchPresetsRoot(this.#presetsPath, isStartingUp, (topicPath) => this.#adoptRuntimePreset(topicPath));
	}

	/**
	 * Handlers de eventos de `index.ts` por capa, compartidos por los watchers de core
	 * y de presets. `add` va al detector (módulo nuevo → pendiente, SIN ejecutar);
	 * `change` recarga sólo módulos ya cargados (pendientes/deshabilitados se ignoran
	 * para no resucitarlos); `unlink` retira pendientes o descarga cargados.
	 */
	#layerEventHandlers(type: ModuleType | "app"): LayerEventHandlers {
		if (type === "app") {
			return {
				add: (p) => this.#detector.detect("app", p),
				change: async (p) => {
					if (await this.#detector.isReloadBlocked("app", p)) {
						this.#logger.logDebug(`Cambio en app pendiente/deshabilitada ignorado: ${p}`);
						return;
					}
					await this.#appLoader.unloadApp(p);
					await this.#appLoader.loadApp(p);
				},
				unlink: async (p) => {
					if (await this.#detector.undetect("app", p)) return;
					await this.#appLoader.unloadApp(p);
				},
			};
		}
		return {
			add: (p) => this.#detector.detect(type, p),
			change: async (p) => {
				if (await this.#detector.isReloadBlocked(type, p)) {
					this.#logger.logDebug(`Cambio en módulo pendiente/deshabilitado ignorado: ${p}`);
					return;
				}
				await this.#dependencyReloader.handleFileChange(type, p);
			},
			unlink: async (p) => {
				if (await this.#detector.undetect(type, p)) return;
				await this.#registry.unloadModule(type, Kernel.#kernelKey, p);
			},
		};
	}

	/**
	 * Config nuevo para un app: si el app ya corre (código confiable), la instancia
	 * nueva se carga como siempre; si el app no corre (directorio nuevo o pendiente),
	 * va al detector y queda pendiente de lanzamiento manual.
	 */
	async #onNewAppConfig(appFilePath: string): Promise<void> {
		const base = path.basename(path.dirname(appFilePath));
		const isRunning = this.#appLoader.instanceNames.some((i) => i === base || i.split(":")[0] === base);
		if (isRunning && !this.#disabledRegistry.getApp(base)?.pending) {
			await this.#appLoader.loadApp(appFilePath);
			return;
		}
		await this.#detector.detect("app", appFilePath);
	}

	/** Adopta un preset aparecido en runtime: topic + watcher de su árbol (módulos → pendientes). */
	#adoptRuntimePreset(topicPath: string): void {
		const topic = path.basename(topicPath);
		if (this.#presetTopics.includes(topic)) return;
		this.#presetTopics.push(topic);
		Kernel.#moduleLoader.setPresetTopics(this.#presetTopics);
		this.#logger.logWarn(
			`Preset nuevo detectado en runtime: '${topic}'. Sus módulos NO se autoejecutan: quedan pendientes de lanzamiento en modules-manager.`
		);
		// `ignoreInitial: false`: los archivos ya copiados/clonados también pasan por el detector.
		watchPresetTopic(topicPath, this.#fileExtension, (layer) => this.#layerEventHandlers(layer), {
			isStartingUp: () => this.#isStartingUp,
			ignoreInitial: false,
		});
	}

	async #refreshUiImportMaps(): Promise<void> {
		try {
			const uiFederation = this.#registry.getService<import("./services/core/UIFederationService/index.ts").default>("UIFederationService");
			if (uiFederation) await uiFederation.refreshAllImportMaps(this.#platformCap);
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
