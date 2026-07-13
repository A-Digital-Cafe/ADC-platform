import * as path from "node:path";
import type { IApp } from "../../interfaces/modules/IApp.js";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { Kernel } from "../../kernel.js";
import type { ModuleRegistry } from "../../utils/registry/ModuleRegistry.js";
import type { DockerManager } from "../../utils/system/DockerManager.js";
import type { DisabledRegistry } from "../orchestration/DisabledRegistry.js";
import { findConfigFiles, getConfigName, isAppDisabled, readJson, type AppCtor } from "./AppFileUtils.js";
import { AppInstanceTracker } from "./AppInstanceTracker.js";
import { AppLifecycle } from "./AppLifecycle.js";
import { AppReloader } from "./AppReloader.js";
import { CircuitBreaker } from "./CircuitBreaker.js";

const RETRY_SHORT_MS = 30_000;
const RETRY_SHORT_MAX = 5;
const RETRY_LONG_MS = 10 * 60_000;

export class AppLoader {
	readonly #tracker = new AppInstanceTracker();
	readonly #breaker: CircuitBreaker;
	readonly #lifecycle: AppLifecycle;
	readonly #reloader: AppReloader;
	readonly #kernelKey: symbol;

	constructor(
		private readonly kernel: Kernel,
		private readonly registry: ModuleRegistry,
		private readonly dockerManager: DockerManager,
		private readonly logger: ILogger,
		kernelKey: symbol,
		private readonly isShuttingDown: () => boolean,
		private readonly disabledRegistry: DisabledRegistry,
		onModuleFailure?: (moduleName: string, error: string) => void
	) {
		this.#kernelKey = kernelKey;
		this.#breaker = new CircuitBreaker({
			shortMs: RETRY_SHORT_MS,
			maxShort: RETRY_SHORT_MAX,
			longMs: RETRY_LONG_MS,
			logger,
			onOpen: (key, lastError) => onModuleFailure?.(key, lastError),
		});
		this.#lifecycle = new AppLifecycle({
			kernel,
			registry,
			tracker: this.#tracker,
			logger,
			kernelKey,
			isShuttingDown,
			disabledRegistry,
			breaker: this.#breaker,
		});
		this.#reloader = new AppReloader({ kernel, tracker: this.#tracker, lifecycle: this.#lifecycle, logger, breaker: this.#breaker });
	}

	get appFilePaths(): ReadonlyMap<string, string> {
		return this.#tracker.appFilePaths;
	}

	get appConfigFilePaths(): ReadonlyMap<string, string> {
		return this.#tracker.appConfigFilePaths;
	}

	removeConfigPath(configPath: string): void {
		this.#tracker.removeConfigPath(configPath);
	}

	reloadAppInstance = (configPath: string): Promise<void> => this.#reloader.reloadAppInstance(configPath);
	reloadAppByInstanceName = (instanceName: string): Promise<void> => this.#reloader.reloadAppByInstanceName(instanceName);

	loadApp = async (filePath: string): Promise<void> => {
		if (this.isShuttingDown()) {
			this.logger.logInfo("Cierre en progreso, abortando carga de app...");
			return;
		}
		try {
			await this.#tryLoadApp(filePath);
			// Carga sana a nivel archivo: olvidar fallos previos (los fallos por
			// instancia se rastrean aparte, por instanceName).
			this.#breaker.clear(filePath);
		} catch (e) {
			this.#handleLoadError(filePath, e as Error);
		}
	};

	async #tryLoadApp(filePath: string): Promise<void> {
		const appDir = path.dirname(filePath);
		const appName = path.basename(appDir);

		// App PENDIENTE (detectada en runtime, nunca aprobada): no se importa ni se levanta.
		// A diferencia de una disabled común (que sigue sirviendo tras el gate), acá el
		// código no debe ejecutarse hasta que un admin la lance desde el modules-manager.
		if (this.disabledRegistry.getApp(appName)?.pending) {
			this.logger.logWarn(`App ${appName} pendiente de lanzamiento (modules-manager): no se carga.`);
			return;
		}

		const module = await import(`${filePath}?v=${Date.now()}`);
		const AppClass: AppCtor | undefined = module.default;
		if (!AppClass) return;

		// Nota: una app deshabilitada por el modules-manager SÍ se levanta (su dev-server/host
		// debe seguir sirviendo): el gate cliente la redirige a la página de mantenimiento.
		// Sólo `disabled: true` en su config la excluye realmente del arranque.
		if (await isAppDisabled(appDir, appName, this.logger)) return;

		try {
			await this.dockerManager.startDockerCompose(appDir, appName);
		} catch {
			this.logger.logDebug(`docker-compose no disponible para ${appName}`);
		}

		const configFiles = await findConfigFiles(appDir, this.logger);

		if (configFiles.length === 0) {
			await this.#tryLoadInstance(AppClass, filePath, appName);
			return;
		}

		for (const configPath of configFiles) {
			await this.#tryLoadInstance(AppClass, filePath, appName, configPath);
		}
	}

	async #tryLoadInstance(AppClass: AppCtor, filePath: string, appName: string, configPath?: string): Promise<void> {
		let config: { disabled?: boolean } | undefined;
		let instanceName = appName;
		if (configPath) {
			config = (await readJson<{ disabled?: boolean }>(configPath)) ?? undefined;
			if (!config) return;
			if (config.disabled === true) {
				this.logger.logDebug(`App ${appName} está deshabilitada (config: ${path.basename(configPath)})`);
				return;
			}
			instanceName = `${appName}:${getConfigName(path.basename(configPath))}`;
		}
		const app: IApp = new AppClass(this.kernel, instanceName, config, filePath);
		try {
			await this.#lifecycle.initializeAndRunApp(app, filePath, instanceName, configPath);
		} catch (e) {
			// Fallo de UNA instancia: no aborta a las hermanas ni re-carga el archivo
			// entero (duplicaría a las sanas); se reintenta sólo esta vía el breaker.
			const error = e instanceof Error ? e : new Error(String(e));
			this.logger.logError(`Error inicializando App ${instanceName}: ${error.message}`);
			this.#lifecycle.scheduleRetry(error, filePath, instanceName, configPath);
		}
	}

	/** Fallo a nivel archivo (import/deps npm): reintenta la carga completa bajo el breaker. */
	#handleLoadError(filePath: string, e: Error): void {
		const prefix =
			(e as { code?: string })?.code === "ERR_MODULE_NOT_FOUND"
				? `Faltan dependencias de Node.js para la app en ${filePath}`
				: `Error cargando App ${filePath}`;
		this.logger.logError(`${prefix}: ${e}`);
		this.#breaker.schedule(filePath, e?.message ?? String(e), () => this.#retryLoad(filePath));
	}

	readonly #retryLoad = async (filePath: string): Promise<void> => {
		if (this.isShuttingDown()) {
			this.#breaker.clear(filePath);
			return;
		}
		await this.#tryLoadApp(filePath); // si lanza, el breaker re-agenda
		this.#breaker.clear(filePath);
	};

	unloadApp = async (filePath: string): Promise<void> => {
		this.#breaker.clear(filePath);
		const keys = this.#tracker.findFileKeysByPrefix(filePath);
		for (const key of keys) {
			await this.#unloadByKey(key);
		}
	};

	async #unloadByKey(key: string): Promise<void> {
		const instanceName = this.#tracker.getInstanceByFileKey(key);
		if (!instanceName) return;
		this.#breaker.clear(instanceName);
		if (!this.registry.hasApp(instanceName)) return;
		const app = this.registry.getApp(instanceName);
		this.logger.logDebug(`Removiendo app: ${app.name}`);
		await app.stop?.(this.#kernelKey);
		await this.registry.cleanupAppModules(instanceName, this.#kernelKey);
		this.registry.deleteApp(app.name);
		this.#tracker.removeByFileKey(key);
		this.#tracker.removeAllByInstance(instanceName);
	}

	// ── API de orquestación (consultas usadas por ModuleOrchestrator) ──

	/** Nombres de instancia de apps actualmente cargadas. */
	get instanceNames(): string[] {
		return [...new Set(this.#tracker.appFilePaths.values())];
	}

	/** Resuelve el filePath del `index.ts` de una instancia de app cargada. */
	findFilePathByInstance(instanceName: string): string | undefined {
		for (const [key, name] of this.#tracker.appFilePaths) {
			if (name === instanceName) return key.slice(0, key.length - (`:${name}`).length);
		}
		return undefined;
	}
}
