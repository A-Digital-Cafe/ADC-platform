import * as path from "node:path";
import * as fs from "node:fs/promises";
import { BaseService } from "../../BaseService.js";
import type { RegisteredUIModule } from "./types.js";
import type { ImportMap, UIModuleConfig } from "../../../interfaces/modules/IUIModule.js";
import type { ILangManagerService } from "../LangManagerService/types.js";
import FastifyServerProvider from "../../../providers/http/fastify-server/index.js";
import type SEOService from "../../data/SEOService/index.js";

import { getStrategy, isFrameworkSupported, getSupportedFrameworks } from "./strategies/index.js";
import { ModuleRegistry } from "./utils/registry/module-registry.js";
import { DEFAULT_NAMESPACE, type HostRegistryEntry, type UIFederationContext } from "./utils/types/context.js";
import { stopAllWatchers } from "./utils/lifecycle/watcher-control.js";
import { runRegisterFlow } from "./utils/lifecycle/register-flow.js";
import { updateImportMap } from "./utils/server/import-map-updater.js";
import { setupImportMapEndpoints } from "./utils/server/endpoints.js";
import { computeStats, refreshAllImportMaps, unregisterUIModule, type UIStats } from "./utils/server/service-operations.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";

export default class UIFederationService extends BaseService {
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
	#seoService: SEOService | null = null;


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
			this.#seoService = this.getMyService<SEOService>("SEOService");
			this.#seoService.attachFastify(this.#httpProvider);
			this.logger.logDebug("SEOService conectado");
		} catch {
			this.logger.logDebug("SEOService no disponible, SEO deshabilitado");
		}
		await setupImportMapEndpoints(this.#ctx());
		await this.#httpProvider.listen(this.#port);
		this.logger.logOk(`UIFederationService iniciado en modo ${this.#isDevelopment ? "desarrollo" : "producción"} (puerto ${this.#port})`);
	}

	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		await stopAllWatchers(this.#watchBuilds, this.logger);
		this.logger.logOk("UIFederationService detenido");
	}

	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore - Falso positivo del IDE con decorador legacy (experimentalDecorators: true)
	@OnlyKernel()
	async registerUIModule(_kernelKey: symbol, name: string, appDir: string, uiConfig: UIModuleConfig): Promise<void> {
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

	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore - Falso positivo del IDE con decorador legacy (experimentalDecorators: true)
	@OnlyKernel()
	unregisterUIModule(_kernelKey: symbol, name: string, namespace?: string): Promise<void> {
		return unregisterUIModule(name, this.#ctx(), namespace);
	}

	getImportMap(namespace?: string): ImportMap {
		return this.#importMaps.get(namespace || DEFAULT_NAMESPACE) || { imports: {} };
	}

	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore - Falso positivo del IDE con decorador legacy (experimentalDecorators: true)
	@OnlyKernel()
	refreshAllImportMaps(_kernelKey: symbol): Promise<void> {
		return refreshAllImportMaps(this.#ctx());
	}

	getStats(): UIStats {
		return computeStats(this.#ctx());
	}
}

export type { RegisteredUIModule } from "./types.js";
