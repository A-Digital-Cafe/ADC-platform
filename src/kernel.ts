import "./utils/env/load-env.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Logger } from "./utils/logger/Logger.js";
import { ModuleLoader } from "./utils/loaders/ModuleLoader.js";
import { invalidateModule } from "./utils/loaders/module-url.js";
import { ModuleRegistry, type ModuleType } from "./utils/registry/ModuleRegistry.js";
import { ReadonlyModuleRegistry } from "./utils/registry/ReadonlyModuleRegistry.ts";
import { Scope, assertScope, CapabilityIssuer, type Capability, type CapabilityToken } from "./common/security/Capability.ts";
import { setLifecycleRoot } from "./utils/decorators/OnlyKernel.ts";
import { policyScopes, INFRA_CAP_SCOPES, type ModuleKind } from "./core/security/capabilityPolicy.ts";
import { PrivilegeLedger, type PrivilegeChange } from "./core/security/PrivilegeLedger.ts";
import { resolveSecurityProfile } from "./common/utils/runtime-env.ts";
import { hasInvalidNodeId, isPrimary, resolveClusterIdentity } from "./common/utils/cluster-env.ts";
import type UIFederationServiceType from "./services/core/UIFederationService/index.ts";

/** Superficie que el kernel usa para inyectar capabilities en un módulo recién construido. */
interface ProvisionableModule {
	setKernelKey(key: symbol): void;
	setCapability?(cap: Capability): void;
	setInfraToken?(token: Capability | symbol): void;
}
import { ILogger } from "./interfaces/utils/ILogger.js";
import { DockerManager, type DockerInspector } from "./utils/system/DockerManager.ts";
import { bootTimeline } from "./utils/system/BootTimeline.ts";
import { AppLoader } from "./core/apps/AppLoader.js";
import { ModuleRegistrar } from "./core/modules/ModuleRegistrar.js";
import { KernelServiceLoader } from "./core/services/KernelServiceLoader.js";
import { ConfigWatcher, watchLayer, watchPresetTopic, watchPresetsRoot, type LayerEventHandlers } from "./core/runtime/ConfigWatcher.js";
import { ModuleDetector } from "./core/runtime/ModuleDetector.js";
import { shutdownKernel } from "./core/runtime/KernelShutdown.js";
import { bootstrapNodeIfPending } from "./core/bootstrap/NodeBootstrap.js";
import { applyNodeRoleFromState, assertNodeStateReadable, powerMode } from "./common/utils/node-state.js";
import { loadLayerRecursive, type LayerLoadOptions } from "./core/apps/LayerLoader.js";
import { LoadSemaphore } from "./utils/system/LoadSemaphore.ts";
import { MemoryProbe } from "./utils/system/MemoryProbe.ts";
import { collectAppConfigs, collectAppConfigsRecursive, type AppLoadInfo } from "./core/apps/AppConfigReader.js";
import { parseLoadAppsEnv, resolveLoadAllowlist } from "./core/apps/LoadAllowlist.js";
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
	/**
	 * Registro de los privilegios concedidos a cada módulo. `provisionModule` es el único
	 * punto por el que pasan el boot, el hot-reload y la recarga tras un `git pull`, así que
	 * es donde se detecta que un módulo se amplió los privilegios entre una provisión y la
	 * siguiente. La persistencia/aprobación las pone el gestor de módulos por el orquestador.
	 */
	readonly #privilegeLedger = new PrivilegeLedger();
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
	/** Se crea en `#startWatchers`; los presets adoptados en runtime se cuelgan de él. */
	#configWatcher?: ConfigWatcher;

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
		this.#privilegeLedger.onChange((change) => this.#onPrivilegeChange(change));
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
			privilegeLedger: this.#privilegeLedger,
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
		// Por identidad pinneada, no por nombre: acá se entrega `identity:internal`, y la
		// resolución por nombre la puede ganar un módulo registrado bajo ese nombre.
		const identity = this.#registry.getPlatformService<IdentityNotifier>("IdentityManagerService");
		if (!identity) {
			this.#logger.logDebug(`Alerta de fallo de módulo no emitida (IdentityManagerService no disponible): ${moduleName}`);
			return;
		}
		void identity
			.notifications(this.#securityNotifyCap)
			.moduleFailure({ module: moduleName, error })
			.catch((e: unknown) => this.#logger.logDebug(`Alerta de fallo de módulo no emitida: ${e}`));
	}

	/**
	 * Un módulo cambió sus privilegios entre una provisión y la siguiente. El caso que importa
	 * es `added`/`withheld` tras una recarga desde disco: el `config.json` que trajo el deploy
	 * pide más de lo que el módulo tenía. Se deja rastro en el log y se avisa al equipo de
	 * seguridad por el mismo canal que los fallos de módulo.
	 *
	 * El alta (`first`) no se notifica: es todo el árbol en cada arranque. La excepción es un alta
	 * con `withheld`: en arranque en frío el módulo se provisiona DESPUÉS de que el gestor instale
	 * el baseline, así que la primera provisión del proceso es justo donde el gate actúa, y sin
	 * esta salida la retención no dejaría más rastro que un warn de `capabilityPolicy`.
	 *
	 * `retroactive` es el otro extremo: el módulo se provisionó ANTES de que existiera el
	 * baseline, así que no alcanza con no conceder — hay que retirarle el scope.
	 */
	#onPrivilegeChange(change: PrivilegeChange): void {
		const { grant, removed, withheld, first } = change;
		if (change.retroactive) this.#revokeGrantedScopes(grant, withheld);
		// En un alta no hay provisión anterior contra la cual diffear: `added` es el set entero
		// del módulo, no una ampliación. Reportarlo como pedido nuevo sería mentira.
		const added = first ? [] : change.added;
		if (first && withheld.length === 0) {
			this.#logger.logDebug(`Privilegios de ${grant.kind}:${grant.name}: [${grant.scopes.join(", ")}]`);
			return;
		}
		const parts = [added.length ? `+[${added.join(", ")}]` : "", removed.length ? `-[${removed.join(", ")}]` : ""].filter(Boolean).join(" ");
		if (withheld.length) {
			// El camino retroactivo ya lo reportó `#revokeGrantedScopes` como "RETIRADOS".
			if (!change.retroactive) {
				const delta = parts ? ` ${parts}` : ""; // en un alta no hay delta: la retención va sola
				this.#logger.logWarn(`Privilegios de ${grant.kind}:${grant.name}: RETENIDOS [${withheld.join(", ")}] por falta de aprobación.${delta}`);
			}
		} else {
			this.#logger.logWarn(`Privilegios de ${grant.kind}:${grant.name} cambiaron: ${parts} (origen: ${grant.path})`);
		}
		if (added.length === 0 && withheld.length === 0) return; // perder privilegios no es un incidente

		interface IdentityNotifier {
			notifications(token: CapabilityToken): {
				modulePrivilegesChanged(event: {
					module: string;
					layer: string;
					filePath: string;
					added: string[];
					withheld: string[];
				}): Promise<void>;
			};
		}
		const identity = this.#registry.getPlatformService<IdentityNotifier>("IdentityManagerService");
		if (!identity?.notifications) return;
		void identity
			.notifications(this.#securityNotifyCap)
			.modulePrivilegesChanged({ module: grant.name, layer: grant.kind, filePath: grant.path, added, withheld })
			.catch((err: unknown) => this.#logger.logDebug(`Alerta de cambio de privilegios no emitida: ${err}`));
	}

	/** Una línea al arranque con el perfil vigente: "¿este deploy corre degradado?" sin leer cinco archivos. */
	#logBootSecurityProfile(): void {
		const profile = resolveSecurityProfile();
		const line = `SECURITY PROFILE: ${profile.name} → ${profile.effects}`;
		if (profile.degraded) this.#logger.logWarn(`${line} — seguridad DEGRADADA a propósito; nunca en un deploy real.`);
		else this.#logger.logInfo(line);
	}

	/**
	 * Identidad de este nodo, al lado del perfil de seguridad y por el mismo motivo: un secundario
	 * que se cree primario levanta una infraestructura paralela y duplica todos los trabajos
	 * programados, y el síntoma aparece mucho después y lejos. Que se lea en el arranque.
	 */
	#logBootClusterIdentity(): void {
		const node = resolveClusterIdentity();
		if (hasInvalidNodeId()) {
			this.#logger.logWarn(
				`ADC_NODE_ID="${process.env.ADC_NODE_ID}" no es un identificador válido (letras, números, guiones); se usa "${node.id}" en su lugar.`
			);
		}
		const label = node.name === node.id ? node.id : `${node.name} (${node.id})`;
		const advertise = node.advertise ? ` · anuncia=${node.advertise}` : ""
		this.#logger.logInfo(
			`NODE: ${label} · rol=${node.role} · sitio=${node.site} · infra=${node.infra}` + `${advertise}${node.gateway ? " · gateway=on" : ""}`
		);
	}

	/**
	 * Retira de la capability viva de un módulo los scopes que el gate hubiera retenido (sólo el
	 * camino retroactivo). Corta las llamadas futuras, pero un handle privilegiado que el módulo ya
	 * haya tomado sigue siendo suyo: por eso se reporta como incidente aunque funcione.
	 */
	#revokeGrantedScopes(grant: PrivilegeChange["grant"], withheld: readonly string[]): void {
		const revoked = this.#issuer.revoke(grant.name, grant.kind, withheld as Scope[]);
		if (revoked.length === 0) return;
		this.#logger.logWarn(
			`Privilegios de ${grant.kind}:${grant.name}: RETIRADOS [${revoked.join(", ")}] al instalarse el baseline ` +
				`(se habían concedido antes de que existiera). Revisar si el módulo alcanzó a usarlos.`
		);
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
		// Ídem `#notifyModuleFailure`: identidad pinneada antes de entregar la capability.
		const identity = this.#registry.getPlatformService<IdentityNotifier>("IdentityManagerService");
		if (!identity) {
			this.#logger.logDebug(`Alerta de módulo detectado no emitida (IdentityManagerService no disponible): ${e.name}`);
			return;
		}
		void identity
			.notifications(this.#securityNotifyCap)
			.moduleDetected({ module: e.name, layer: e.type, filePath: e.filePath, preset: e.preset })
			.catch((err: unknown) => this.#logger.logDebug(`Alerta de módulo detectado no emitida: ${err}`));
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
	 * Vista **sólo‑lectura** de la infra Docker (composes levantados y disponibilidad del binario),
	 * para el bloque de contenedores del panel de módulos. Mismo gate que `getOrchestrator`; no se
	 * entrega el `DockerManager`, que además puede levantar y bajar contenedores.
	 */
	public getDockerInspector(token: CapabilityToken): DockerInspector {
		assertScope(token, Scope.Orchestrator, Kernel.#kernelKey);
		const docker = this.#dockerManager;
		return {
			listComposeTargets: () => docker.listComposeTargets(),
			dockerAvailable: () => docker.dockerAvailable(),
			dockerPath: () => docker.dockerPath(),
		};
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
		// Privilegios: se calculan contra el baseline aprobado (si hay gate activo) y se anota
		// lo concedido, para que una ampliación entre provisiones no pase inadvertida.
		const declared = opts.declared ?? [];
		const withheld = this.#privilegeLedger.withheldFor(opts.kind, opts.name, declared);
		const scopes = policyScopes({ ...opts, withheld });
		const businessCap = this.#issuer.mint(opts.name, opts.kind, scopes);
		this.#privilegeLedger.record({ kind: opts.kind, name: opts.name, path: opts.path, scopes, declared, at: Date.now() }, withheld);
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
		this.#logBootSecurityProfile();
		// Antes del banner y antes de todo lo que decida por rol: si el panel promovió este nodo a
		// primario, lo que sigue tiene que verlo ya promovido —empezando por qué composes levanta—.
		applyNodeRoleFromState();
		this.#logBootClusterIdentity();
		this.#logger.logDebug(`Base path: ${this.#basePath}`);

		// Si el estado operativo de este nodo quedó ilegible, en producción se corta acá. Lo que sigue
		// decide qué motores levanta la máquina, y adivinarlo es cómo un nodo vuelve de un corte con
		// una base de datos en paralelo a la del clúster.
		assertNodeStateReadable();

		// Alta de un nodo virgen, ANTES de levantar infraestructura y de cargar un solo módulo: es
		// el único punto donde el proceso ya sabe quién es y todavía no dejó nada a medias. Sin
		// variables de alta (el caso normal) no hace nada.
		await bootTimeline.measure("node:bootstrap", () => bootstrapNodeIfPending(this.#basePath, this.#logger));

		this.#presetTopics = await this.#discoverPresetTopics();
		if (this.#presetTopics.length > 0) {
			this.#logger.logInfo(`Presets detectados: ${this.#presetTopics.join(", ")}`);
		}
		Kernel.#moduleLoader.setPresetTopics(this.#presetTopics);

		await bootTimeline.measure("docker:compose", () => this.#dockerManager.loadCommonDockerCompose(path.resolve(this.#basePath, "common", "docker")));
		await bootTimeline.measure("services:kernel", () =>
			this.#kernelServiceLoader.loadAll([this.#servicesPath, ...this.#presetLayerPaths("services")])
		);

		// `ENABLE_TESTS` manda también en desarrollo: el árbol `apps/test` son 8 apps que
		// nadie usa para iterar sobre features y que cuestan su propio hijo de bundler.
		const excludeTests = process.env.ENABLE_TESTS !== "true";
		const excludeList = excludeTests ? ["BaseApp.ts", "AppWithSeo.ts", "test"] : ["BaseApp.ts", "AppWithSeo.ts"];

		// Boot dirigido a nivel CARGA (`ADC_LOAD_APPS`), no sólo de build: lo que queda fuera
		// se suma al exclude —así ni se lee su config— y se le declara dormido al orquestador,
		// que si no lo contaría como caída pasados los 3 min de gracia.
		excludeList.push(...(await this.#applyLoadAllowlist(excludeList)));

		// En espera: el nodo levantó sus motores y entró al registro, pero no carga UNA sola app.
		// Es lo que permite que una máquina vuelva de un corte de luz sin ponerse a servir hasta
		// que alguien lo decida — y lo que hace que «apagar» signifique algo bajo un supervisor
		// que, por definición, vuelve a levantar todo lo que sale.
		if (powerMode() === "standby") {
			this.#logger.logWarn("[nodo] EN ESPERA: los motores están arriba y /healthz responde 503; no se carga ninguna app.");
			this.#logger.logWarn('[nodo] Para ponerlo en servicio: panel de red → Nodos → Encender (o poner "power": "on" en env/node-state.json y reiniciar).');
			excludeList.push(...(await this.#applyStandbyExclusions(excludeList)));
		}

		// Las UI libraries de presets cargan antes que cualquier otra app: hosts de src o
		// de otros presets pueden declararlas en uiDependencies, y la carga de presets es
		// secuencial/alfabética (sin este pase, un host anterior espera 30s por la lib).
		await this.#enableDeferredUiBuilds(excludeList);

		const presetUiLibs = await this.#collectPresetUiLibs(excludeList);
		const semaphore = new LoadSemaphore({ maxParallel: LoadSemaphore.defaultMaxParallel(), probe: new MemoryProbe(), logger: this.#logger });
		const layerOptions = this.#layerLoadOptions(excludeList, semaphore);
		try {
			// Las UI libs van en serie y sin gate: son el cuello del que todos cuelgan.
			await bootTimeline.measure("apps:preset-uilibs", async () => {
				for (const lib of presetUiLibs) {
					await loadLayerRecursive(lib.path, { ...layerOptions, gate: undefined });
				}
			});
			const presetExcludeList = [...excludeList, ...presetUiLibs.map((lib) => lib.dirName)];

			await bootTimeline.measure("apps:src", () => loadLayerRecursive(this.#appsPath, layerOptions));
			await bootTimeline.measure("apps:presets", async () => {
				const presetOptions = this.#layerLoadOptions(presetExcludeList, semaphore);
				await Promise.all(this.#presetLayerPaths("apps").map((appsPath) => loadLayerRecursive(appsPath, presetOptions)));
			});
			this.#logger.logDebug(`[boot] techo de carga ${semaphore.stats.ceiling} (freno: ${semaphore.stats.brake})`);
		} finally {
			semaphore.dispose();
		}

		this.#startWatchers();
		await bootTimeline.measure("apps:deferred-builds", () => this.#drainDeferredUiBuilds());
		await this.#refreshUiImportMaps();
		this.#scheduleStartupReady();
		this.#scheduleStatusInterval();
	}

	/**
	 * Opciones de carga de una capa de apps. El `gate` es el MISMO semáforo para todas las
	 * ramas (capas de `src` y de cada preset): si cada rama trajera el suyo, el techo sería
	 * por rama y el pico real se multiplicaría por la cantidad de ramas en vuelo.
	 */
	#layerLoadOptions(excludeList: string[], semaphore: LoadSemaphore): LayerLoadOptions {
		return {
			loader: this.#appLoader.loadApp,
			exclude: excludeList,
			fileExtension: this.#fileExtension,
			logger: this.#logger,
			isShuttingDown: () => this.#isShuttingDown,
			gate: (label, fn) => semaphore.run(label, fn),
		};
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

	/**
	 * Aplica `ADC_LOAD_APPS`: devuelve los directorios de app a EXCLUIR de la carga y se los
	 * declara dormidos al orquestador. Vacío (el default) = se cargan todas, como siempre.
	 *
	 * El allowlist se resuelve sobre TODAS las capas de una (src + presets) porque el cierre
	 * transitivo de `uiDependencies` cruza repos: pedir `adc-drive` (preset) tiene que
	 * arrastrar `adc-ui-library` (src). Ver `LoadAllowlist.ts`.
	 */
	async #applyLoadAllowlist(excludeList: string[]): Promise<string[]> {
		const requested = parseLoadAppsEnv(process.env.ADC_LOAD_APPS);
		if (requested.length === 0) return [];

		const layers = [this.#appsPath, ...this.#presetLayerPaths("apps")];
		const apps: AppLoadInfo[] = [];
		for (const layerPath of layers) {
			apps.push(...(await collectAppConfigsRecursive(layerPath, excludeList, this.#fileExtension)));
		}

		const { load, dormant, unknown } = resolveLoadAllowlist(apps, requested);
		if (unknown.length > 0) {
			this.#logger.logWarn(`ADC_LOAD_APPS: sin coincidencia para ${unknown.join(", ")} (¿nombre de app o de directorio mal escrito?).`);
		}
		this.#logger.logInfo(`Boot dirigido (ADC_LOAD_APPS): ${load.size} app(s) a cargar, ${dormant.size} dormida(s).`);
		this.#orchestrator.setDormantApps(dormant);
		return [...dormant];
	}

	/**
	 * En espera: **todas** las apps quedan dormidas.
	 *
	 * Dormidas y no excluidas, igual que en el boot dirigido: el orquestador cuenta como caída lo que
	 * no aparece pasados los 3 min de gracia, y un nodo en espera pondría la plataforma entera en
	 * rojo en la página de estado.
	 *
	 * Los motores SÍ se levantan: son la copia de datos de este nodo, y un secundario que volviera
	 * de un corte con el Mongo apagado dejaría el replica set degradado hasta que alguien lo encienda.
	 */
	async #applyStandbyExclusions(excludeList: string[]): Promise<string[]> {
		const layers = [this.#appsPath, ...this.#presetLayerPaths("apps")];
		const apps: AppLoadInfo[] = [];
		for (const layerPath of layers) {
			apps.push(...(await collectAppConfigsRecursive(layerPath, excludeList, this.#fileExtension)));
		}
		const dormant = new Set(apps.map((app) => app.dirName));
		this.#logger.logWarn(`[nodo] EN ESPERA: ${dormant.size} app(s) dormidas. Los motores de datos sí están arriba.`);
		this.#orchestrator.setDormantApps(dormant);
		return [...dormant];
	}

	/**
	 * Enciende el diferimiento de builds UI para lo que queda del arranque (ver
	 * `docs/architecture/boot-performance.md`).
	 *
	 * Se difieren las **hojas**: los módulos cuyo `buildStatus` nadie consulta. El complemento
	 * (`observed`) sale de leer los `config.json` antes de cargar nada: UI libraries, remotes y todo
	 * lo nombrado en un `uiDependencies` ajeno.
	 *
	 * Errar el conjunto no rompe nada —un diferido que alguien espere degrada al techo del poll
	 * (30/60 s) y sigue—, pero el criterio es conservador: ante la duda, no se difiere.
	 */
	async #enableDeferredUiBuilds(excludeList: string[]): Promise<void> {
		// Con `ADC_NO_UI_SERVERS` el build es un no-op y diferirlo sólo agrega ruido.
		if (process.env.ADC_NO_UI_SERVERS === "true") return;
		// Mismo espíritu que `BOOT_MAX_PARALLEL=1`: volver al comportamiento anterior por una corrida
		// hace depurable un problema de orden de build.
		if (process.env.ADC_DEFER_UI_BUILDS === "false") {
			this.#logger.logInfo("Builds UI diferidos DESACTIVADOS por ADC_DEFER_UI_BUILDS=false.");
			return;
		}
		const uiFederation = this.#registry.getPlatformService<UIFederationServiceType>("UIFederationService");
		if (!uiFederation) return;

		const observed = new Set<string>();
		for (const layerPath of [this.#appsPath, ...this.#presetLayerPaths("apps")]) {
			for (const app of await collectAppConfigsRecursive(layerPath, excludeList, this.#fileExtension)) {
				for (const dep of app.dependencies) observed.add(dep);
				if (!app.isUILib && !app.isRemote) continue;
				observed.add(app.name);
				// `BaseApp` registra `web-foo` como `foo` cuando el config no declara `uiModule.name`;
				// `AppConfigReader` no puede saberlo, así que entran las dos grafías.
				if (app.name.startsWith("web-")) observed.add(app.name.slice(4));
			}
		}

		uiFederation.enableDeferredBuilds(this.#platformCap, observed);
		this.#logger.logDebug(`[boot] builds UI diferibles: todo lo que no esté en las ${observed.size} dependencias observadas.`);
	}

	/** Espera los builds UI diferidos y vuelve al modo síncrono. */
	async #drainDeferredUiBuilds(): Promise<void> {
		try {
			const uiFederation = this.#registry.getPlatformService<UIFederationServiceType>("UIFederationService");
			await uiFederation?.drainDeferredBuilds(this.#platformCap);
		} catch (error: any) {
			this.#logger.logError(`Error drenando los builds UI diferidos: ${error.message}`);
		}
	}

	/** UI libraries (Stencil con exports) presentes en las capas apps de los presets. */
	async #collectPresetUiLibs(excludeList: string[]): Promise<{ path: string; dirName: string }[]> {
		const libs: { path: string; dirName: string }[] = [];
		for (const appsPath of this.#presetLayerPaths("apps")) {
			try {
				const entries = await fs.readdir(appsPath, { withFileTypes: true });
				const configs = await collectAppConfigs(appsPath, entries, excludeList);
				libs.push(...configs.filter((c) => c.isUILib).map((c) => ({ path: c.path, dirName: c.dirName })));
			} catch {
				/* preset sin capa apps */
			}
		}
		return libs;
	}

	#startWatchers(): void {
		// Los watchers son competencia EXCLUSIVA del primario. Con dos nodos sobre el mismo árbol,
		// cada `add` lo detectarían los dos y el módulo entraría como pendiente (y se auditaría, y
		// se notificaría a seguridad) por duplicado; con árboles separados, cada nodo detectaría lo
		// suyo y divergirían en silencio. El hot reload de desarrollo tampoco tiene sentido en un
		// secundario: su código lo trae el deploy, no una edición local.
		if (!isPrimary()) {
			this.#logger.logInfo("Nodo secundario: no se montan watchers de filesystem ni detección de módulos nuevos (los hace el primario).");
			return;
		}

		const isStartingUp = () => this.#isStartingUp;

		// Capas del core (los directorios siempre existen).
		for (const type of ["provider", "utility", "service"] as ModuleType[]) {
			const dir = { provider: this.#providersPath, utility: this.#utilitiesPath, service: this.#servicesPath }[type] as string;
			watchLayer(dir, this.#fileExtension, this.#layerEventHandlers(type), { isStartingUp });
		}
		// Un único árbol chokidar sobre `src/apps`: lo comparten el router de `index.ts` y el
		// ConfigWatcher (`.json`), en vez de montar dos árboles idénticos sobre los mismos directorios.
		const appsWatcher = watchLayer(this.#appsPath, this.#fileExtension, this.#layerEventHandlers("app"), {
			isStartingUp,
			exclude: ["BaseApp.ts", "AppWithSeo.ts"],
		});

		this.#configWatcher = new ConfigWatcher({
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
			watcher: appsWatcher,
		});
		this.#configWatcher.start();

		// Presets conocidos al boot: un watcher por topic (cubre capas creadas después).
		for (const topic of this.#presetTopics) {
			this.#watchPresetTree(path.resolve(this.#presetsPath, topic), isStartingUp);
		}

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
					invalidateModule(p);
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
				invalidateModule(p);
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

	/**
	 * Watcher del árbol de un preset: enruta sus `index.<ext>` por capa y, sobre el MISMO
	 * árbol, los `config*.json` de sus apps (que viven fuera de `src/apps`).
	 */
	#watchPresetTree(topicPath: string, isStartingUp: () => boolean, ignoreInitial?: boolean): void {
		const watcher = watchPresetTopic(topicPath, this.#fileExtension, (layer) => this.#layerEventHandlers(layer), {
			isStartingUp,
			ignoreInitial,
		});
		this.#configWatcher?.attach(watcher, { root: topicPath, layer: "apps" });
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
		this.#watchPresetTree(topicPath, () => this.#isStartingUp, false);
	}

	async #refreshUiImportMaps(): Promise<void> {
		try {
			// Por identidad pinneada: `refreshAllImportMaps` recibe `platform:infra`.
			const uiFederation = this.#registry.getPlatformService<UIFederationServiceType>("UIFederationService");
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
			// Acá el arranque terminó de verdad (los builds que siguen corriendo son watchers, no boot).
			bootTimeline.finish();
			this.#markNodeReady();
		}, 10000);
	}

	/**
	 * Declara el nodo listo para recibir tráfico (`GET /healthz` pasa de 503 a 200).
	 *
	 * Se hace acá y no al terminar `start()` porque lo que un balanceador necesita saber no es que
	 * los módulos se cargaron, sino que el proceso ya no está en modo arranque: mandarle requests
	 * antes es exactamente lo que el drenaje durante un deploy existe para evitar.
	 */
	#markNodeReady(): void {
		if (!this.#registry.hasAnyModule("service", "ClusterService")) return;
		try {
			this.#registry.getService<{ markReady?: () => void }>("ClusterService").markReady?.();
		} catch (error) {
			this.#logger.logDebug(`No se pudo marcar el nodo como listo: ${(error as Error).message}`);
		}
	}

	/**
	 * Latido de contadores del registry cada 5 min (la serie por módulo ya la expone modules-manager).
	 *
	 * No volver a meter acá el dump del estado del kernel: eran ~23 KB sin lector cada 30 s, que
	 * reciclaban entero el ring buffer de `GET /api/logs` y salían crudos y sin redactar a stdout.
	 */
	#scheduleStatusInterval(): void {
		this.#statusInterval = setInterval(() => {
			const stats = this.#registry.getModuleStats();
			this.#logger.logInfo(`Providers: ${stats.providers} - Utilities: ${stats.utilities} - Services: ${stats.services}`);
		}, 300_000);
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
