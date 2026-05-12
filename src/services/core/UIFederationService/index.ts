import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseService } from "../../BaseService.js";
import type { RegisteredUIModule } from "./types.js";
import type { ImportMap, UIModuleConfig } from "../../../interfaces/modules/IUIModule.js";
import type { ILangManagerService } from "../LangManagerService/types.js";

// Utilidades
import { generateCompleteImportMap, createImportMapObject } from "./utils/import-map.js";
import { injectImportMapsInHTMLs, generateIndexHtml, generateMainEntryPoint } from "./utils/html-processor.js";
import { generateServiceWorker } from "./utils/service-worker-generator.js";
import { registerPublicAssets } from "./utils/public-assets.js";
import { getUIModuleHostOptions } from "./utils/security.js";

// Strategy Pattern
import { getStrategy, isFrameworkSupported, getSupportedFrameworks, parseFramework } from "./strategies/index.js";
import type { IBuildContext } from "./strategies/types.js";
import { generateI18nClientCode } from "./utils/i18n-generator.ts";
import FastifyServerProvider from "../../../providers/http/fastify-server/index.ts";

const DEFAULT_NAMESPACE = "default";

export default class UIFederationService extends BaseService {
	public readonly name = "UIFederationService";

	// Módulos organizados por namespace: Map<namespace, Map<moduleName, module>>
	private readonly registeredModules = new Map<string, Map<string, RegisteredUIModule>>();
	private readonly watchBuilds = new Map<string, any>();
	// Import maps por namespace
	private readonly importMaps = new Map<string, ImportMap>();
	private langManager: ILangManagerService | null = null;
	private readonly uiOutputBaseDir: string;
	private readonly port: number = 3000;
	private readonly isDevelopment: boolean;
	// Registro de hosts para producción: hostPattern -> { namespace, moduleName, directory }
	private readonly hostRegistry = new Map<string, { namespace: string; moduleName: string; directory: string }>();

	// Expuesto para IUIFederationService
	#httpProvider: FastifyServerProvider | null = null;

	constructor(kernel: any, options?: any) {
		super(kernel, options);

		this.isDevelopment = process.env.NODE_ENV === "development";
		const basePath = this.isDevelopment ? path.resolve(process.cwd(), "src") : path.resolve(process.cwd(), "dist");
		this.uiOutputBaseDir = path.resolve(basePath, "..", "temp", "ui-builds");

		// Puerto: 80 para producción real, 3000 para prodtests/dev
		const prodPort = !this.isDevelopment && (process.env.PROD_PORT ?? 80);
		this.port = options?.port || prodPort || 3000;
	}

	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		await fs.mkdir(this.uiOutputBaseDir, { recursive: true });

		try {
			// Usamos Fastify con host-based routing en todos los entornos
			this.#httpProvider = this.getMyProvider<FastifyServerProvider>("fastify-server");
		} catch (error: any) {
			this.logger.logError(`Error cargando HttpServerProvider: ${error.message}`);
			throw error;
		}

		// Obtener LangManagerService si está disponible
		try {
			this.langManager = this.getMyService<any>("LangManagerService");
			this.logger.logDebug("LangManagerService conectado");
		} catch {
			this.logger.logDebug("LangManagerService no disponible, i18n deshabilitado");
		}

		await this.#setupImportMapEndpoints();
		await this.#httpProvider.listen(this.port);

		const mode = this.isDevelopment ? "desarrollo" : "producción";
		this.logger.logOk(`UIFederationService iniciado en modo ${mode} (puerto ${this.port})`);
	}

	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);

		// Matar procesos de build watch
		for (const [name, watcher] of this.watchBuilds.entries()) {
			try {
				this.logger.logDebug(`Deteniendo watcher: ${name}`);

				if (watcher && typeof watcher.kill === "function") {
					watcher.kill("SIGTERM");
					await new Promise((resolve) => setTimeout(resolve, 1000));

					if (!watcher.killed) {
						this.logger.logDebug(`Forzando terminación de watcher: ${name}`);
						watcher.kill("SIGKILL");
					}

					if (watcher.pid && process.platform !== "win32") {
						try {
							process.kill(-watcher.pid, "SIGKILL");
						} catch (error: any) {
							this.logger.logDebug(`Error matando grupo de procesos ${watcher.pid}: ${error.message}`);
						}
					}
				}
			} catch (error: any) {
				this.logger.logWarn(`Error deteniendo watcher ${name}: ${error.message}`);
			}
		}
		this.watchBuilds.clear();

		this.logger.logOk("UIFederationService detenido");
	}

	/**
	 * Obtiene el Map de módulos para un namespace específico
	 */
	#getNamespaceModules(namespace: string): Map<string, RegisteredUIModule> {
		if (!this.registeredModules.has(namespace)) {
			this.registeredModules.set(namespace, new Map());
		}
		return this.registeredModules.get(namespace)!;
	}

	/**
	 * Obtiene un módulo específico por namespace y nombre
	 */
	#getModule(namespace: string, name: string): RegisteredUIModule | null {
		const namespaceModules = this.registeredModules.get(namespace);
		if (!namespaceModules) return null;
		return namespaceModules.get(name) || null;
	}

	/**
	 * Obtiene el módulo host (layout) de un namespace
	 */
	#getHostModule(namespace: string): RegisteredUIModule | null {
		const namespaceModules = this.registeredModules.get(namespace);
		if (!namespaceModules) return null;
		for (const mod of namespaceModules.values()) {
			if (mod.uiConfig.isHost) return mod;
		}
		return null;
	}

	/**
	 * Busca un módulo por nombre en todos los namespaces (legacy)
	 */
	#findModuleByName(name: string): { namespace: string; module: RegisteredUIModule } | null {
		for (const [namespace, modules] of this.registeredModules.entries()) {
			if (modules.has(name)) {
				return { namespace, module: modules.get(name)! };
			}
		}
		return null;
	}

	/**
	 * Registra un módulo UI
	 */
	async registerUIModule(name: string, appDir: string, uiConfig: UIModuleConfig): Promise<void> {
		const namespace = uiConfig.uiNamespace || DEFAULT_NAMESPACE;
		const framework = uiConfig.framework || "astro";

		// Validar framework soportado
		if (!isFrameworkSupported(framework)) {
			throw new Error(`Framework "${framework}" no soportado. ` + `Opciones: ${getSupportedFrameworks().join(", ")}`);
		}

		// Obtener y validar estrategia
		const strategy = getStrategy(framework);
		strategy.validateConfig(uiConfig);

		this.logger.logInfo(`Registrando módulo UI: ${name} [${namespace}] (${strategy.name})`);

		const namespaceModules = this.#getNamespaceModules(namespace);
		const isDevelopment = process.env.NODE_ENV === "development";
		const isHost = uiConfig.isHost ?? false;

		const module: RegisteredUIModule = {
			name,
			namespace,
			appDir,
			uiConfig: { ...uiConfig, uiNamespace: namespace },
			registeredAt: Date.now(),
			buildStatus: "pending",
		};

		namespaceModules.set(name, module);
		this.#updateImportMap(namespace);

		try {
			// Generar archivos standalone SOLO para hosts (index.html, entry point)
			if (isHost) await this.#generateStandaloneFiles(appDir, uiConfig);

			// Build del módulo usando la estrategia (genera Module Federation para hosts y remotes)
			await this.#buildUIModuleInternal(module, namespace);

			// Post-build: inyectar import maps si tiene output
			if (module.outputPath) await this.#injectImportMapsInModuleHTMLs(name, namespace);

			this.#updateImportMap(namespace);

			// Servir módulo según su configuración
			await this.#serveModule(module, namespace, isDevelopment);

			// Registrar assets públicos (del módulo y sus uiDependencies)
			if (this.#httpProvider) {
				await registerPublicAssets({
					module,
					namespaceModules,
					logger: this.logger,
					serveStatic: (urlPath, dir) => this.#httpProvider!.serveStatic(urlPath, dir),
				});
			}

			// Registrar traducciones i18n si está habilitado
			// Pasar uiDependencies como dependencias de i18n para deep merge
			if (uiConfig.i18n && this.langManager) {
				const i18nDependencies = uiConfig.uiDependencies?.filter((dep) => {
					// Solo incluir dependencias que tengan i18n habilitado
					const depModule = namespaceModules.get(dep);
					return depModule?.uiConfig.i18n;
				});
				await this.langManager.registerNamespace(name, appDir, i18nDependencies);
			}

			// Generar y registrar i18n client si está habilitado (solo para layouts/hosts)
			if (uiConfig.i18n && isHost) await this.#registerI18nClientEndpoint(namespace);

			// Generar y registrar service worker si está habilitado (solo para layouts/hosts)
			if (uiConfig.serviceWorker && isHost) await this.#registerServiceWorkerEndpoint(namespace);

			// Si este es un módulo remote (no host), regenerar configs de hosts en el mismo namespace
			if (!isHost && uiConfig.devPort) await this.#regenerateLayoutConfigsForNamespace(namespace);
		} catch (error: any) {
			module.buildStatus = "error";
			this.logger.logError(`Error registrando módulo UI ${name}: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Regenera configuraciones de layouts cuando se registra un nuevo remote
	 */
	async #regenerateLayoutConfigsForNamespace(namespace: string): Promise<void> {
		const namespaceModules = this.#getNamespaceModules(namespace);

		for (const [moduleName, module] of namespaceModules.entries()) {
			const isHost = module.uiConfig.isHost ?? false;
			// Solo regenerar hosts que ya fueron construidos
			if (isHost && module.buildStatus === "built") {
				this.logger.logInfo(`Regenerando config de ${moduleName} por nuevo remote en ${namespace}`);

				const strategy = getStrategy(module.uiConfig.framework || "react");

				// Solo regenerar si tiene devPort (dev server de rspack/vite)
				if (module.uiConfig.devPort && process.env.NODE_ENV === "development") {
					try {
						// Matar el watcher actual si existe
						if (module.watcher && !module.watcher.killed) {
							this.logger.logDebug(`Deteniendo dev server de ${moduleName}...`);
							module.watcher.kill("SIGTERM");
							// Esperar un momento para que el proceso termine
							await new Promise((resolve) => setTimeout(resolve, 1000));
						}

						const namespaceOutputDir = path.join(this.uiOutputBaseDir, namespace);

						const context = {
							module,
							namespace,
							registeredModules: namespaceModules,
							uiOutputBaseDir: namespaceOutputDir,
							isDevelopment: true,
							logger: this.logger,
						};

						this.logger.logDebug(`Reiniciando dev server de ${moduleName}...`);
						// Reiniciar el dev server con el nuevo config
						const result = await strategy.startDevServer(context);

						// Actualizar el watcher
						if (result.watcher) {
							module.watcher = result.watcher;
							const watcherKey = `${namespace}:${moduleName}`;
							this.watchBuilds.set(watcherKey, result.watcher);
						}

						this.logger.logOk(`Dev server reiniciado para ${moduleName} con nuevos remotes`);
					} catch (error: any) {
						this.logger.logWarn(`Error regenerando config de ${moduleName}: ${error.message}`);
					}
				}
			}
		}
	}

	/**
	 * Sirve el módulo según su configuración
	 */
	async #serveModule(module: RegisteredUIModule, namespace: string, isDevelopment: boolean): Promise<void> {
		const { bundler } = parseFramework(module.uiConfig.framework || "astro");

		// En desarrollo: comportamiento tradicional con dev servers
		if (isDevelopment) {
			// Módulos con devPort (rspack/vite): se sirven en su propio puerto
			if (module.uiConfig.devPort && (bundler === "rspack" || bundler === "vite"))
				this.logger.logOk(
					`Módulo UI ${module.name} [${namespace}] disponible en Dev Server http://localhost:${module.uiConfig.devPort}`
				);
			// Módulos sin devPort o CLI: servir estáticamente desde httpProvider
			else if (this.#httpProvider && module.outputPath) {
				const urlPath = `/${namespace}/${module.name}`;
				this.#httpProvider.serveStatic(urlPath, module.outputPath);
				this.logger.logOk(`Módulo UI ${module.name} [${namespace}] servido en http://localhost:${this.port}${urlPath}`);
			}
			return;
		}

		// En producción: usar host-based routing con Fastify
		if (!this.#httpProvider || !module.outputPath) return;

		const hosting = module.uiConfig.hosting;

		// Si el módulo tiene configuración de hosting, registrar hosts virtuales
		if (hosting && this.#httpProvider.supportsHostRouting()) {
			await this.#registerHostsForModule(module, namespace, this.#httpProvider);
		} else {
			// Fallback: servir estáticamente por path (como en desarrollo pero sin dev server)
			const urlPath = `/${namespace}/${module.name}`;
			this.#httpProvider.serveStatic(urlPath, module.outputPath);
			this.logger.logOk(`Módulo UI ${module.name} [${namespace}] servido en http://localhost:${this.port}${urlPath}`);
		}
	}

	/**
	 * Registra hosts virtuales para un módulo en producción
	 */
	async #registerHostsForModule(module: RegisteredUIModule, namespace: string, hostProvider: FastifyServerProvider): Promise<void> {
		const hosting = module.uiConfig.hosting;
		if (!hosting || !module.outputPath) return;

		const registeredPatterns: string[] = [];
		const hostOptions = getUIModuleHostOptions(module.uiConfig);

		// Procesar configuración de hosts específica
		for (const hostConfig of hosting) {
			for (const domain of hostConfig.domains) {
				if (hostConfig.subdomains) {
					for (const subdomain of hostConfig.subdomains) {
						const pattern = `${subdomain}.${domain}`;
						hostProvider.registerHost(pattern, module.outputPath, hostOptions);
						this.hostRegistry.set(pattern, { namespace, moduleName: module.name, directory: module.outputPath });
						registeredPatterns.push(pattern);
					}
				} else {
					hostProvider.registerHost(domain, module.outputPath, hostOptions);
					this.hostRegistry.set(domain, { namespace, moduleName: module.name, directory: module.outputPath });
					registeredPatterns.push(domain);
				}
			}
		}

		if (registeredPatterns.length > 0)
			this.logger.logOk(`Módulo UI ${module.name} [${namespace}] servido en hosts: ${registeredPatterns.join(", ")}`);
	}

	async unregisterUIModule(name: string, namespace?: string): Promise<void> {
		this.logger.logInfo(`Desregistrando módulo UI: ${name}`);

		// Si se proporciona namespace, usar ese directamente
		if (namespace) {
			const namespaceModules = this.registeredModules.get(namespace);
			if (namespaceModules && namespaceModules.has(name)) {
				namespaceModules.delete(name);
				this.#updateImportMap(namespace);
				this.logger.logOk(`Módulo UI ${name} [${namespace}] desregistrado`);
				return;
			}
		}

		// Fallback: buscar en todos los namespaces
		const found = this.#findModuleByName(name);
		if (!found) {
			this.logger.logWarn(`Módulo UI ${name} no encontrado`);
			return;
		}

		const { namespace: foundNamespace } = found;
		const namespaceModules = this.#getNamespaceModules(foundNamespace);
		namespaceModules.delete(name);
		this.#updateImportMap(foundNamespace);

		this.logger.logOk(`Módulo UI ${name} [${foundNamespace}] desregistrado`);
	}

	getImportMap(namespace?: string): ImportMap {
		const ns = namespace || DEFAULT_NAMESPACE;
		return this.importMaps.get(ns) || { imports: {} };
	}

	/**
	 * Build interno usando Strategy Pattern
	 */
	async #buildUIModuleInternal(module: RegisteredUIModule, namespace: string): Promise<void> {
		const framework = module.uiConfig.framework || "astro";
		const strategy = getStrategy(framework);
		const namespaceModules = this.#getNamespaceModules(namespace);
		const namespaceOutputDir = path.join(this.uiOutputBaseDir, namespace);

		// Si NO es una UI library (stencil), esperar a que la UI library del namespace termine
		if (framework !== "stencil") await this.#waitForUILibraryBuild(namespace, module.name);

		// Si es un host, esperar a que sus remotes declarados estén registrados
		const isHost = module.uiConfig.isHost ?? false;
		if (isHost) await this.#waitForDeclaredRemotes(module, namespace);

		module.buildStatus = "building";
		this.logger.logInfo(`Build: ${module.name} [${namespace}] usando ${strategy.name}`);

		try {
			// Crear contexto de build
			const context: IBuildContext = {
				module,
				namespace,
				registeredModules: namespaceModules,
				uiOutputBaseDir: namespaceOutputDir,
				logger: this.logger,
				isDevelopment: process.env.NODE_ENV === "development",
			};

			// Ejecutar build con la estrategia
			const result = await strategy.build(context);

			// Guardar watcher si existe
			if (result.watcher) {
				const watcherKey = `${namespace}:${module.name}`;
				this.watchBuilds.set(watcherKey, result.watcher);
				module.watcher = result.watcher; // También guardarlo en el módulo
			}

			// Guardar output path
			if (result.outputPath) module.outputPath = result.outputPath;

			module.buildStatus = "built";

			if (!context.isDevelopment) {
				this.logger.logOk(`Build completado para ${module.name} [${namespace}]`);
			}
		} catch (error: any) {
			module.buildStatus = "error";
			this.logger.logError(`Error en build de ${module.name}: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Espera a que la UI library (Stencil) del namespace termine de construirse
	 */
	async #waitForUILibraryBuild(namespace: string, waitingModuleName: string): Promise<void> {
		const namespaceModules = this.#getNamespaceModules(namespace);

		// Buscar la UI library (Stencil) del namespace
		let uiLibrary: RegisteredUIModule | null = null;
		for (const mod of namespaceModules.values()) {
			if (mod.uiConfig.framework === "stencil") {
				uiLibrary = mod;
				break;
			}
		}

		if (!uiLibrary) return;

		if (uiLibrary.buildStatus === "built") return;

		// Si está building o pending, esperar
		if (uiLibrary.buildStatus === "building" || uiLibrary.buildStatus === "pending") {
			this.logger.logDebug(`${waitingModuleName} esperando a que ${uiLibrary.name} termine de construirse...`);

			const maxWaitTime = 60000; // 60 segundos máximo
			const checkInterval = 500;

			await Promise.race([
				new Promise<void>((resolve) => {
					const interval = setInterval(() => {
						if (uiLibrary.buildStatus === "built") {
							clearInterval(interval);
							return resolve();
						}
						if (uiLibrary.buildStatus === "error") {
							clearInterval(interval);
							return resolve();
						}
					}, checkInterval);
				}),
				new Promise<void>((resolve) => setTimeout(resolve, maxWaitTime)),
			]).then(() => {
				if (uiLibrary.buildStatus === "built") {
					this.logger.logDebug(`${uiLibrary.name} listo, ${waitingModuleName} puede continuar`);
				} else if (uiLibrary.buildStatus === "error") {
					this.logger.logWarn(`${uiLibrary.name} falló, ${waitingModuleName} continuará sin UI library`);
				}
			});
			this.logger.logWarn(`Timeout esperando ${uiLibrary.name}, ${waitingModuleName} continuará de todas formas`);
		}
	}

	/**
	 * Espera a que los remotes declarados en uiDependencies estén registrados
	 * Esto asegura que cuando el host haga su build, los remotes ya estén en registeredModules
	 */
	async #waitForDeclaredRemotes(hostModule: RegisteredUIModule, namespace: string): Promise<void> {
		const uiDependencies = hostModule.uiConfig.uiDependencies || [];
		if (uiDependencies.length === 0) return;

		const namespaceModules = this.#getNamespaceModules(namespace);
		const missingRemotes: string[] = [];

		// Filtrar dependencias que son remotes (excluir UI libraries que ya fueron esperadas)
		for (const depName of uiDependencies) {
			const depModule = namespaceModules.get(depName);
			// Si no existe o no está construido, necesitamos esperar
			if (!depModule || (depModule.buildStatus !== "built" && depModule.uiConfig.framework !== "stencil")) {
				missingRemotes.push(depName);
			}
		}

		if (missingRemotes.length === 0) return;

		this.logger.logDebug(`${hostModule.name} esperando remotes: ${missingRemotes.join(", ")}`);

		const maxWaitTime = 30000; // 30 segundos máximo
		const checkInterval = 500;
		let elapsed = 0;

		while (elapsed < maxWaitTime && missingRemotes.length > 0) {
			// Verificar qué remotes ya están listos
			const stillMissing: string[] = [];
			for (const remoteName of missingRemotes) {
				const remoteModule = namespaceModules.get(remoteName);
				if (!remoteModule || remoteModule.buildStatus === "pending" || remoteModule.buildStatus === "building") {
					stillMissing.push(remoteName);
				}
			}

			if (stillMissing.length === 0) {
				this.logger.logDebug(`Todos los remotes listos para ${hostModule.name}`);
				return;
			}

			await new Promise((resolve) => setTimeout(resolve, checkInterval));
			elapsed += checkInterval;

			// Actualizar lista de remotes faltantes
			missingRemotes.length = 0;
			missingRemotes.push(...stillMissing);
		}

		if (missingRemotes.length > 0) {
			this.logger.logWarn(
				`Timeout esperando remotes para ${hostModule.name}: ${missingRemotes.join(", ")}. ` +
					`El host se construirá sin ellos (se agregarán cuando se registren).`
			);
		}
	}

	async refreshAllImportMaps(): Promise<void> {
		this.logger.logInfo("Reinyectando import maps en todos los módulos...");

		for (const [namespace, modules] of this.registeredModules.entries()) {
			for (const [name, module] of modules.entries()) {
				if (module.buildStatus === "built" && module.outputPath) {
					await this.#injectImportMapsInModuleHTMLs(name, namespace);
				}
			}
			this.#updateImportMap(namespace);
		}

		this.logger.logOk("Import maps actualizados en todos los módulos");
	}

	getStats(): { registeredModules: number; importMapEntries: number; modules: RegisteredUIModule[]; namespaces: string[] } {
		const allModules: RegisteredUIModule[] = [];
		let totalImportEntries = 0;

		for (const [namespace, modules] of this.registeredModules.entries()) {
			allModules.push(...modules.values());
			const importMap = this.importMaps.get(namespace);
			if (importMap) {
				totalImportEntries += Object.keys(importMap.imports).length;
			}
		}

		return {
			registeredModules: allModules.length,
			importMapEntries: totalImportEntries,
			modules: allModules,
			namespaces: Array.from(this.registeredModules.keys()),
		};
	}

	async #generateStandaloneFiles(appDir: string, config: UIModuleConfig): Promise<void> {
		const { baseFramework } = parseFramework(config.framework || "astro");

		if (baseFramework === "react" || baseFramework === "vue") {
			const indexHtmlPath = path.join(appDir, "index.html");

			// Solo generar index.html si no existe (preservar modificaciones custom)
			try {
				await fs.access(indexHtmlPath);
				this.logger.logDebug(`index.html existente preservado para ${config.name}`);
			} catch {
				const indexHtmlContent = generateIndexHtml(config.name, baseFramework);
				await fs.writeFile(indexHtmlPath, indexHtmlContent, "utf-8");
				this.logger.logDebug(`index.html generado para ${config.name}`);
			}

			const mainExt = baseFramework === "react" ? ".tsx" : ".ts";
			const mainPath = path.join(appDir, "src", `main${mainExt}`);
			try {
				await fs.access(mainPath);
			} catch {
				const mainContent = generateMainEntryPoint(baseFramework);
				await fs.writeFile(mainPath, mainContent, "utf-8");
				this.logger.logDebug(`src/main${mainExt} generado para ${config.name}`);
			}
		}
	}

	async #setupImportMapEndpoints(): Promise<void> {
		if (!this.#httpProvider) return;

		// Helper para extraer el hostname del request (sin puerto)
		const getRequestHost = (req: any): string => {
			const hostHeader = req.headers?.host || req.hostname || "localhost";
			// Extraer solo el hostname, sin el puerto
			return hostHeader.split(":")[0];
		};

		// Endpoint para import map por namespace (generado dinámicamente)
		this.#httpProvider.registerRoute("GET", "/:namespace/importmap.json", (req: any, reply: any) => {
			const namespace = req.params?.namespace || DEFAULT_NAMESPACE;
			const host = getRequestHost(req);
			const namespaceModules = this.#getNamespaceModules(namespace);
			const imports = generateCompleteImportMap(namespaceModules, this.port, namespace, host);
			reply.header("Content-Type", "application/json");
			reply.send(createImportMapObject(imports));
		});

		// Endpoint legacy para import map (namespace default, generado dinámicamente)
		this.#httpProvider.registerRoute("GET", "/importmap.json", (req: any, reply: any) => {
			const host = getRequestHost(req);
			const namespaceModules = this.#getNamespaceModules(DEFAULT_NAMESPACE);
			const imports = generateCompleteImportMap(namespaceModules, this.port, DEFAULT_NAMESPACE, host);
			reply.header("Content-Type", "application/json");
			reply.send(createImportMapObject(imports));
		});

		// Endpoint para listar namespaces disponibles
		this.#httpProvider.registerRoute("GET", "/api/ui/namespaces", (_req: any, reply: any) => {
			reply.send({
				namespaces: Array.from(this.registeredModules.keys()),
				default: DEFAULT_NAMESPACE,
			});
		});

		// Endpoints i18n
		this.#httpProvider.registerRoute("GET", "/api/i18n/:namespace", (req: any, reply: any) => {
			const namespace = req.params?.namespace;
			const locale = req.query?.locale;

			if (!this.langManager) {
				reply.code(503).send({ error: "LangManagerService no disponible" });
				return;
			}

			const translations = this.langManager.getTranslations(namespace, locale);
			reply.header("Content-Type", "application/json");
			reply.send(translations);
		});

		this.#httpProvider.registerRoute("GET", "/api/i18n", (req: any, reply: any) => {
			const namespaces = (req.query?.namespaces || "").split(",").filter(Boolean);
			const locale = req.query?.locale;

			if (!this.langManager) {
				reply.code(503).send({ error: "LangManagerService no disponible" });
				return;
			}

			if (namespaces.length === 0) {
				reply.send(this.langManager.getStats());
				return;
			}

			const translations = this.langManager.getBundledTranslations(namespaces, locale);
			reply.header("Content-Type", "application/json");
			reply.send(translations);
		});

		// Ruta raíz: solo registrar en desarrollo (en producción, Fastify maneja "/" por host)
		if (this.isDevelopment) {
			this.#httpProvider.registerRoute("GET", "/", (req: any, reply: any) => {
				const layoutModule = this.#getHostModule(DEFAULT_NAMESPACE);
				const host = getRequestHost(req);

				// En desarrollo: redirigir al dev server de Vite
				if (layoutModule?.uiConfig.devPort) {
					reply.redirect(`http://${host}:${layoutModule.uiConfig.devPort}/`);
					return;
				}

				// Sin devPort: mostrar lista de namespaces
				const namespaces = Array.from(this.registeredModules.keys());
				reply.header("Content-Type", "text/html");
				reply.send(`
					<!DOCTYPE html>
					<html>
					<head><title>UI Namespaces</title></head>
					<body style="font-family: system-ui; padding: 20px;">
						<h1>UI Namespaces Disponibles</h1>
						<ul>
							${namespaces
								.map((ns) => {
									const nsLayout = this.#getHostModule(ns);
									if (nsLayout?.uiConfig.devPort) {
										return `<li><a href="http://${host}:${nsLayout.uiConfig.devPort}/">${ns}</a></li>`;
									}
									return `<li><a href="/${ns}/${nsLayout?.name || "layout"}/">${ns}</a></li>`;
								})
								.join("")}
						</ul>
					</body>
					</html>
				`);
			});
		}

		this.logger.logDebug(
			"Endpoints registrados: /:namespace/importmap.json, /importmap.json, /api/ui/namespaces" + (this.isDevelopment ? ", /" : "")
		);
	}

	#updateImportMap(namespace: string): void {
		const namespaceModules = this.#getNamespaceModules(namespace);
		const imports = generateCompleteImportMap(namespaceModules, this.port, namespace);
		this.importMaps.set(namespace, createImportMapObject(imports));
		this.logger.logDebug(`Import map [${namespace}] actualizado con ${Object.keys(imports).length} entradas`);
	}

	async #injectImportMapsInModuleHTMLs(moduleName: string, namespace: string): Promise<void> {
		const module = this.#getModule(namespace, moduleName);
		if (!module || !module.outputPath) return;

		const namespaceModules = this.#getNamespaceModules(namespace);
		const importMap = generateCompleteImportMap(namespaceModules, this.port, namespace);
		await injectImportMapsInHTMLs(module.outputPath, importMap, this.logger);
		this.logger.logDebug(`Import maps inyectados en HTMLs de ${moduleName} [${namespace}]`);
	}

	async #registerI18nClientEndpoint(namespace: string): Promise<void> {
		if (!this.#httpProvider) return;

		const namespaceModules = this.#getNamespaceModules(namespace);
		const layoutModule = this.#getHostModule(namespace);

		if (!layoutModule) return;

		try {
			const i18nClientContent = generateI18nClientCode(layoutModule, namespaceModules, this.port);
			const i18nPath = layoutModule.uiConfig.devPort ? "/adc-i18n.js" : `/${namespace}/adc-i18n.js`;
			this.#httpProvider.registerRoute("GET", i18nPath, (_req: any, reply: any) => {
				reply.header("Content-Type", "application/javascript");
				reply.send(i18nClientContent);
			});
			this.logger.logDebug(`i18n Client [${namespace}] registrado en ${i18nPath}`);
		} catch (error: any) {
			this.logger.logDebug(`Endpoint i18n ya registrado para ${namespace}`);
		}
	}

	async #registerServiceWorkerEndpoint(namespace: string): Promise<void> {
		if (!this.#httpProvider) return;

		const namespaceModules = this.#getNamespaceModules(namespace);
		const layoutModule = this.#getHostModule(namespace);

		if (!layoutModule) return;

		try {
			const swContent = generateServiceWorker(layoutModule, namespaceModules, this.port);
			const swPath = layoutModule.uiConfig.devPort ? "/adc-sw.js" : `/${namespace}/adc-sw.js`;
			this.#httpProvider.registerRoute("GET", swPath, (_req: any, reply: any) => {
				reply.header("Content-Type", "application/javascript");
				reply.header("Service-Worker-Allowed", "/");
				reply.send(swContent);
			});
			this.logger.logDebug(`Service Worker [${namespace}] registrado en ${swPath}`);
		} catch (error: any) {
			this.logger.logDebug(`Endpoint SW ya registrado para ${namespace}`);
		}
	}
}

export type { RegisteredUIModule } from "./types.js";
