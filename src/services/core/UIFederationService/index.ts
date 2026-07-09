import * as path from "node:path";
import * as fs from "node:fs/promises";
import { BaseService } from "../../BaseService.js";
import type { RegisteredUIModule } from "./types.js";
import type { ImportMap, UIModuleConfig } from "../../../interfaces/modules/IUIModule.js";
import type { ILangManagerService } from "../LangManagerService/types.js";
import FastifyServerProvider from "../../../providers/http/fastify-server/index.js";
import type { ISEOService } from "../../../common/types/SEO/Service.js";

import { getStrategy, isFrameworkSupported, getSupportedFrameworks } from "./strategies/index.js";
import { ModuleRegistry } from "./utils/registry/module-registry.js";
import { DEFAULT_NAMESPACE, type HostRegistryEntry, type UIFederationContext } from "./utils/types/context.js";
import { stopAllWatchers } from "./utils/lifecycle/watcher-control.js";
import { runRegisterFlow } from "./utils/lifecycle/register-flow.js";
import { buildUIModule } from "./utils/lifecycle/build-runner.js";
import { updateImportMap } from "./utils/server/import-map-updater.js";
import { setupImportMapEndpoints } from "./utils/server/endpoints.js";
import { computeStats, refreshAllImportMaps, unregisterUIModule, type UIStats } from "./utils/server/service-operations.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import { Scope, assertScope, type Capability, type CapabilityToken } from "@common/security/Capability.ts";
import type { IUIFederationService } from "@common/types/ui/IUIFederationService.ts";

export default class UIFederationService extends BaseService implements IUIFederationService {
	public readonly name = "UIFederationService";

	readonly #registry = new ModuleRegistry();
	readonly #importMaps = new Map<string, ImportMap>();
	readonly #watchBuilds = new Map<string, any>();
	readonly #hostRegistry = new Map<string, HostRegistryEntry>();
	readonly #uiOutputBaseDir: string;
	readonly #port: number;
	readonly #isDevelopment: boolean;
	#langManager: ILangManagerService | null = null;
	#httpProvider: FastifyServerProvider | null = null;
	#seoService: ISEOService | null = null;

	constructor(kernel: any, options?: any) {
		super(kernel, options);
		this.#isDevelopment = process.env.NODE_ENV === "development";
		const basePath = this.#isDevelopment ? path.resolve(process.cwd(), "src") : path.resolve(process.cwd(), "dist");
		this.#uiOutputBaseDir = path.resolve(basePath, "..", "temp", "ui-builds");
		const prodPort = !this.#isDevelopment && (process.env.PROD_PORT ?? 80);
		this.#port = options?.port || prodPort || 3000;
	}

	#ctx(): UIFederationContext {
		return {
			registry: this.#registry,
			importMaps: this.#importMaps,
			watchBuilds: this.#watchBuilds,
			hostRegistry: this.#hostRegistry,
			httpProvider: this.#httpProvider,
			langManager: this.#langManager,
			logger: this.logger,
			port: this.#port,
			uiOutputBaseDir: this.#uiOutputBaseDir,
			isDevelopment: this.#isDevelopment,
			getSEOService: () => this.#seoService,
		};
	}

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		await fs.mkdir(this.#uiOutputBaseDir, { recursive: true });
		try {
			this.#httpProvider = this.getMyProvider<FastifyServerProvider>("fastify-server");
		} catch (error: any) {
			this.logger.logError(`Error cargando HttpServerProvider: ${error.message}`);
			throw error;
		}
		try {
			this.#langManager = this.getMyService<any>("LangManagerService");
			this.logger.logDebug("LangManagerService conectado");
		} catch {
			this.logger.logDebug("LangManagerService no disponible, i18n deshabilitado");
		}
		try {
			this.#seoService = this.getMyService<ISEOService>("SEOService");
			this.#seoService.attachFastify(this.#httpProvider);
			this.logger.logDebug("SEOService conectado");
		} catch {
			this.logger.logDebug("SEOService no disponible, SEO deshabilitado");
		}
		await setupImportMapEndpoints(this.#ctx());
		await this.#httpProvider.listen(this.#port);
		this.logger.logOk(`UIFederationService iniciado en modo ${this.#isDevelopment ? "desarrollo" : "producción"} (puerto ${this.#port})`);
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		await stopAllWatchers(this.#watchBuilds, this.logger);
		this.logger.logOk("UIFederationService detenido");
	}

	/**
	 * SEOService se reinició: la instancia previa quedó muerta y la nueva arranca sin
	 * el hook `onSend` ni los datos. Re-adquirimos la instancia y la re-enganchamos a
	 * fastify; las apps re-registran sus datos vía su propio `onDependencyRestored`.
	 */
	public override onDependencyRestored(dependencyName: string): void {
		if (dependencyName !== "SEOService" || !this.#httpProvider) return;
		try {
			this.#seoService = this.getMyService<ISEOService>("SEOService");
			this.#seoService.attachFastify(this.#httpProvider);
			this.logger.logDebug("SEOService re-conectado tras reinicio");
		} catch {
			this.#seoService = null;
			this.logger.logDebug("SEOService no disponible al intentar re-conectar");
		}
	}

	async registerUIModule(token: Capability, name: string, appDir: string, uiConfig: UIModuleConfig): Promise<void> {
		assertScope(token, Scope.UiRegister);
		const namespace = uiConfig.uiNamespace || DEFAULT_NAMESPACE;
		const framework = uiConfig.framework || "astro";

		if (!isFrameworkSupported(framework)) {
			throw new Error(`Framework "${framework}" no soportado. Opciones: ${getSupportedFrameworks().join(", ")}`);
		}
		const strategy = getStrategy(framework);
		strategy.validateConfig(uiConfig);

		this.logger.logInfo(`Registrando módulo UI: ${name} [${namespace}] (${strategy.name})`);

		const module: RegisteredUIModule = {
			name,
			namespace,
			appDir,
			uiConfig: { ...uiConfig, uiNamespace: namespace },
			registeredAt: Date.now(),
			buildStatus: "pending",
		};

		this.#registry.getNamespaceModules(namespace).set(name, module);
		updateImportMap(namespace, this.#ctx());
		await runRegisterFlow(module, this.#ctx());
	}

	unregisterUIModule(token: Capability, name: string, namespace?: string): Promise<void> {
		assertScope(token, Scope.UiRegister);
		return unregisterUIModule(name, this.#ctx(), namespace);
	}

	getImportMap(namespace?: string): ImportMap {
		return this.#importMaps.get(namespace || DEFAULT_NAMESPACE) || { imports: {} };
	}

	/**
	 * Reinyecta los import maps de todas las namespaces. Infra UI invocada por el
	 * kernel (en boot) y el orquestador; gateada por `platform:infra` (que sólo mintea
	 * el kernel), de modo que un módulo no pueda dispararla.
	 */
	refreshAllImportMaps(cap: CapabilityToken): Promise<void> {
		assertScope(cap, Scope.PlatformInfra);
		return refreshAllImportMaps(this.#ctx());
	}

	getStats(): UIStats {
		return computeStats(this.#ctx());
	}

	/**
	 * Info de los módulos UI registrados (read-only). `isLibrary` = framework Stencil:
	 * son librerías de Web Components compartidas (no se "despliegan"/detienen, se
	 * recompilan). Lo consume el modules-manager para tratarlas distinto.
	 */
	listModulesInfo(): Array<{ name: string; namespace: string; framework: string; isLibrary: boolean; isHost: boolean; buildStatus: string }> {
		return this.#registry.allModules.map((m) => ({
			name: m.name,
			namespace: m.namespace,
			framework: m.uiConfig.framework || "astro",
			isLibrary: (m.uiConfig.framework || "") === "stencil",
			isHost: m.uiConfig.isHost ?? false,
			buildStatus: m.buildStatus,
		}));
	}

	/**
	 * Recompila un módulo UI **en su lugar**, sin desregistrarlo (los consumidores no
	 * se cortan; recogen el nuevo build). Pensado para ui-libraries Stencil tras un
	 * `git pull`. En desarrollo el `stencil build --watch` ya reconstruye al cambiar
	 * los archivos, así que es no-op; en producción re-ejecuta el build estático.
	 */
	async rebuildModule(cap: CapabilityToken, moduleName: string): Promise<{ rebuilt: boolean; mode: "watch" | "static"; error?: string }> {
		assertScope(cap, Scope.PlatformInfra);
		const found = this.#registry.findModuleByName(moduleName);
		if (!found) return { rebuilt: false, mode: this.#isDevelopment ? "watch" : "static", error: `Módulo UI no encontrado: ${moduleName}` };

		if (this.#isDevelopment) {
			this.logger.logInfo(`Rebuild ${moduleName}: en desarrollo el watch de Stencil/rspack reconstruye automáticamente.`);
			return { rebuilt: true, mode: "watch" };
		}

		try {
			this.logger.logInfo(`Recompilando módulo UI ${moduleName} [${found.namespace}] en producción...`);
			await buildUIModule(found.module, found.namespace, this.#ctx());
			this.logger.logOk(`Módulo UI ${moduleName} recompilado.`);
			return { rebuilt: true, mode: "static" };
		} catch (error: any) {
			this.logger.logError(`Error recompilando ${moduleName}: ${error.message}`);
			return { rebuilt: false, mode: "static", error: error.message };
		}
	}
}

export type { RegisteredUIModule } from "./types.js";
