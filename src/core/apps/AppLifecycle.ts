import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IApp } from "../../interfaces/modules/IApp.js";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { ModuleRegistry } from "../../utils/registry/ModuleRegistry.js";
import type { Kernel } from "../../kernel.js";
import type { AppInstanceTracker } from "./AppInstanceTracker.js";
import type { DisabledRegistry } from "../orchestration/DisabledRegistry.js";
import type { CircuitBreaker } from "./CircuitBreaker.js";
import { readBaseConfig } from "./AppConfigMerger.js";
import { readJson, type AppCtor } from "./AppFileUtils.js";
import { stopBoundModule } from "../../utils/decorators/OnlyKernel.ts";

/**
 * Corrida estable: si `run()` sobrevivió al menos este tiempo antes de fallar, el
 * fallo cuenta como episodio nuevo (se resetea el historial del breaker) en vez de
 * seguir acumulando hacia el circuito abierto.
 */
const STABLE_RUN_MS = 60_000;

export interface AppLifecycleDeps {
	kernel: Kernel;
	registry: ModuleRegistry;
	tracker: AppInstanceTracker;
	logger: ILogger;
	kernelKey: symbol;
	isShuttingDown: () => boolean;
	disabledRegistry: DisabledRegistry;
	breaker: CircuitBreaker;
}

export class AppLifecycle {
	private readonly deps: Readonly<AppLifecycleDeps>;

	constructor(deps: AppLifecycleDeps) {
		this.deps = Object.freeze({ ...deps });
	}

	initializeAndRunApp = async (app: IApp, filePath: string, instanceName: string, configPath?: string): Promise<void> => {
		const { kernel, logger, registry, tracker, kernelKey, isShuttingDown } = this.deps;
		if (isShuttingDown()) {
			logger.logDebug(`Cierre en progreso, no se inicializa app: ${instanceName}`);
			return;
		}
		logger.logInfo(`Inicializando App: ${instanceName} desde ${path.basename(filePath)}`);
		registry.registerApp(instanceName, app);
		logger.logDebug(`Inicializando App ${app.name}`);

		registry.setLoadingContext(instanceName);
		try {
			// Privilegios opt-in del app (default.json → `privileges`): scopes sensibles como
			// `identity:system` sólo si el app los declara; si no, tier "app" = lifecycle + ui:register.
			const baseConfig = await readBaseConfig(path.dirname(filePath));
			const declared = Array.isArray(baseConfig.privileges) ? baseConfig.privileges : undefined;
			// Provisionar (mintea/inyecta businessCap e infraCap + token de ciclo de vida) ANTES
			// de cargar: loadModulesFromConfig usa la infraCap contenida; start valida el token.
			const lifecycleToken = kernel.provisionModule(kernelKey, app, { name: instanceName, kind: "app", path: filePath, declared });
			await app.loadModulesFromConfig();
			await app.start?.(lifecycleToken);
		} finally {
			registry.setLoadingContext(null);
		}

		if (isShuttingDown()) {
			logger.logDebug(`Cierre en progreso, no se ejecuta run() para: ${instanceName}`);
			return;
		}

		tracker.registerInstance(filePath, instanceName, configPath);
		logger.logDebug(`Ejecutando App ${app.name}`);
		const startedAt = Date.now();
		app.run().catch((e: Error) => this.#onRunFailure(e, startedAt, filePath, instanceName, configPath));
	};

	/** Agenda la re-inicialización de una instancia fallida bajo la política del breaker. */
	scheduleRetry(error: Error, filePath: string, instanceName: string, configPath?: string): void {
		this.deps.breaker.schedule(instanceName, error.message, () => this.#retryInstance(filePath, instanceName, configPath));
	}

	#onRunFailure(e: Error, startedAt: number, filePath: string, instanceName: string, configPath?: string): void {
		const { logger, breaker, disabledRegistry, isShuttingDown } = this.deps;
		if (isShuttingDown()) return;
		if (disabledRegistry.hasApp(instanceName)) {
			breaker.clear(instanceName);
			logger.logWarn(`App ${instanceName} falló pero está deshabilitada (modules-manager): sin reintentos hasta re-habilitarla.`);
			return;
		}
		// Corrió estable un buen rato: el fallo es un episodio nuevo, reintentos rápidos frescos.
		if (Date.now() - startedAt >= STABLE_RUN_MS) breaker.clear(instanceName);
		logger.logError(`Error ejecutando App ${instanceName}: {}`, e.message);
		this.scheduleRetry(e, filePath, instanceName, configPath);
	}

	/**
	 * Reintento de una instancia: limpia la anterior y levanta una NUEVA (una instancia
	 * ya provisionada no puede re-provisionarse: token/caps se inyectan una sola vez).
	 * Re-chequea shutdown, disabled (modules-manager y `config.disabled`) y que el
	 * archivo siga existiendo antes de tocar nada; si lanza, el breaker re-agenda.
	 */
	async #retryInstance(filePath: string, instanceName: string, configPath?: string): Promise<void> {
		const { kernel, logger, breaker, disabledRegistry, isShuttingDown } = this.deps;
		if (isShuttingDown()) {
			breaker.clear(instanceName);
			return;
		}
		if (disabledRegistry.hasApp(instanceName)) {
			breaker.clear(instanceName);
			logger.logInfo(`Reintento de ${instanceName} cancelado: deshabilitada desde modules-manager.`);
			return;
		}
		try {
			await fs.access(filePath);
		} catch {
			breaker.clear(instanceName);
			logger.logInfo(`Reintento de ${instanceName} cancelado: ${filePath} ya no existe.`);
			return;
		}
		let config: { disabled?: boolean } | undefined;
		if (configPath) {
			config = (await readJson<{ disabled?: boolean }>(configPath)) ?? undefined;
			if (!config || config.disabled === true) {
				breaker.clear(instanceName);
				logger.logInfo(`Reintento de ${instanceName} cancelado: config ausente o deshabilitada.`);
				return;
			}
		}
		await this.stopAndCleanupInstance(instanceName);
		const module = await import(`${filePath}?v=${Date.now()}`);
		const AppClass: AppCtor | undefined = module.default;
		if (!AppClass) {
			breaker.clear(instanceName);
			logger.logError(`Reintento de ${instanceName} cancelado: ${filePath} no exporta una app.`);
			return;
		}
		const app: IApp = new AppClass(kernel, instanceName, config, filePath);
		await this.initializeAndRunApp(app, filePath, instanceName, configPath);
	}

	async stopAndCleanupInstance(instanceName: string): Promise<void> {
		const { registry, tracker, logger, kernelKey } = this.deps;
		if (!registry.hasApp(instanceName)) return;
		const app = registry.getApp(instanceName);
		logger.logInfo(`Deteniendo instancia de App: ${instanceName}`);
		await stopBoundModule(app, kernelKey);
		await registry.cleanupAppModules(instanceName, kernelKey);
		registry.deleteApp(instanceName);
		tracker.removeFileKeysByInstance(instanceName);
	}
}
