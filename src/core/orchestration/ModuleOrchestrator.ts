import * as fs from "node:fs/promises";
import * as path from "node:path";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { isInsideBase } from "@common/utils/path-containment.ts";
import { moduleConfigCheck } from "@common/schemas/module-config.ts";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { ModuleRegistry, ModuleType } from "../../utils/registry/ModuleRegistry.js";
import type { AppLoader } from "../apps/AppLoader.js";
import type { ModuleRegistrar } from "../modules/ModuleRegistrar.js";
import type { DependencyReloader } from "../modules/DependencyReloader.js";
import type { DisabledEntry, DisabledRegistry } from "./DisabledRegistry.js";
import type { ModuleDetector, ModuleDetectionEvent } from "../runtime/ModuleDetector.js";
import { DependencyGraph } from "./DependencyGraph.js";
import type {
	DisableOptions,
	FriendlyGroupState,
	ModuleSnapshotItem,
	OrchestratorLayer,
	PersistedStatusItem,
	ReloadReport,
	ReloadTarget,
	TargetModules,
} from "./types.js";
import type { Capability } from "@common/security/Capability.ts";
import type { PrivilegeChange, PrivilegeGrant, PrivilegeLedger } from "../security/PrivilegeLedger.js";

/**
 * Margen tras el arranque antes de declarar "caído" a un módulo que nunca se vio cargado.
 * Las apps/services tardan en levantar durante el boot; sin este margen, la detección de
 * fallos los marcaría a todos como caídos al inicio.
 */
const FAILURE_GRACE_MS = 180_000;

/**
 * Cuánto tiene que llevar AUSENTE un módulo antes de declararlo caído. Una recarga
 * (deploy, re-habilitar, hot reload en dev) lo saca del registry durante segundos: sin
 * esta confirmación, cualquier muestreo que caiga en ese hueco lo reporta como fallo y
 * abre un incidente automático que se resuelve solo al tick siguiente.
 */
const ABSENCE_CONFIRM_MS = 90_000;

/** Controlador de 503 expuesto por EndpointManagerService. Gateado por `platform:infra`. */
interface EndpointUnavailabilityController {
	setOwnerUnavailable(cap: Capability, ownerName: string, on: boolean, message?: string): void;
}

/** Controlador de UI federada expuesto por UIFederationService (sólo para recompilar ui-libraries). */
interface UIController {
	rebuildModule(cap: Capability, moduleName: string): Promise<{ rebuilt: boolean; mode: "watch" | "static"; error?: string }>;
	listModulesInfo(): Array<{ name: string; namespace: string; framework: string; isLibrary: boolean; isHost: boolean; buildStatus: string }>;
}

export interface ModuleOrchestratorDeps {
	registry: ModuleRegistry;
	appLoader: AppLoader;
	registrar: ModuleRegistrar;
	dependencyReloader: DependencyReloader;
	disabledRegistry: DisabledRegistry;
	detector: ModuleDetector;
	logger: ILogger;
	kernelKey: symbol;
	/** Capability `platform:infra` del kernel para operaciones de infra (503/rebuild UI). */
	platformCap: Capability;
	/** Registro de privilegios concedidos: el gestor de módulos lo persiste y lo aprueba. */
	privilegeLedger: PrivilegeLedger;
	presetsPath: string;
	srcPath: string;
}

interface StopNode {
	type: OrchestratorLayer;
	name: string;
}

/** Módulo que opcionalmente reacciona al restablecimiento de una dependencia (ver BaseModule). */
interface NotifiableModule {
	onDependencyRestored?(dependencyName: string): void | Promise<void>;
}

/**
 * Orquestador de módulos en runtime. Centraliza la lógica de habilitar/deshabilitar
 * apps/services/providers/utilities con cascada de dependientes, el modo
 * mantenimiento (cliente + server-side) y la recarga desde disco tras git pull.
 *
 * No persiste: el preset `adc-modules-manager` es dueño de la persistencia en mongo
 * y empuja el estado al boot vía `applyPersistedStatus`. Sólo es accesible con la
 * `kernelKey` (ver `Kernel.getOrchestrator`).
 */
export class ModuleOrchestrator {
	readonly #d: Readonly<ModuleOrchestratorDeps>;
	readonly #graph = new DependencyGraph();
	#graphBuilt = false;
	/** Miembros (`type:name`) vistos cargados alguna vez: distingue "se cayó" de "aún arrancando". */
	readonly #everLoaded = new Set<string>();
	/** Miembro (`type:name`) → instante en que se lo vio ausente por primera vez (ver `ABSENCE_CONFIRM_MS`). */
	readonly #absentSince = new Map<string, number>();
	/** Fin del margen de arranque para la detección de fallos (se fija en la 1ª consulta). */
	#failureGraceUntil = 0;
	/**
	 * Apps (nombre BASE) que este arranque decidió no cargar (`ADC_LOAD_APPS`). Sin esto,
	 * `memberState` las ve "configuradas pero no cargadas" y pasada la gracia de 3 minutos
	 * las declara caídas: la status page pública se pondría roja por una decisión de
	 * arranque local. Lo fija el kernel una vez, antes de cargar apps.
	 */
	readonly #dormantApps = new Set<string>();

	constructor(deps: ModuleOrchestratorDeps) {
		this.#d = Object.freeze({ ...deps });
	}

	/** Construye (una vez) el grafo de dependencias desde los config.json en disco. */
	async #ensureGraph(): Promise<DependencyGraph> {
		if (!this.#graphBuilt) {
			await this.#graph.build(this.#d.srcPath, this.#d.presetsPath);
			this.#graphBuilt = true;
		}
		return this.#graph;
	}

	/** Fuerza reconstruir el grafo (tras un git pull que pudo cambiar configs). */
	#invalidateGraph(): void {
		this.#graphBuilt = false;
	}

	// ── Consultas de estado ────────────────────────────────────────────────────

	isAppDisabled(instanceName: string): boolean {
		return this.#d.disabledRegistry.hasApp(instanceName);
	}

	isDisabled(type: OrchestratorLayer, name: string): boolean {
		return this.#d.disabledRegistry.has(type, name);
	}

	/** Mapa público (apps deshabilitadas) para el endpoint de availability. */
	/**
	 * Suscribe un observador de módulos nuevos detectados en runtime (quedan pendientes,
	 * sin ejecutar). Lo usa el preset modules-manager para persistir/auditar/notificar.
	 */
	onModuleDetected(cb: (e: ModuleDetectionEvent) => void): void {
		this.#d.detector.onDetected(cb);
	}

	/**
	 * Privilegios concedidos hasta ahora. El gestor de módulos lo consulta en su arranque
	 * para diffear contra el baseline persistido: los services de prioridad menor a la suya
	 * ya fueron provisionados y no dispararon `onPrivilegeChange`.
	 */
	privilegeGrants(): PrivilegeGrant[] {
		return this.#d.privilegeLedger.list();
	}

	/** Suscribe cambios de privilegios (apps y recargas posteriores al arranque del gestor). */
	onPrivilegeChange(cb: (change: PrivilegeChange) => void): void {
		this.#d.privilegeLedger.onChange(cb);
	}

	/**
	 * Instala el baseline aprobado de privilegios. Con `gateEnabled`, un scope declarado que no
	 * figure en la aprobación de su módulo NO se concede en la próxima provisión: es lo que
	 * impide que un `git pull` amplíe privilegios por su cuenta.
	 *
	 * Va apagado por defecto: un gate fail-closed sin nadie que apruebe deja módulos legítimos
	 * a medio arrancar tras un deploy. El registro y el aviso a seguridad son incondicionales.
	 */
	setPrivilegeApprovals(approvals: ReadonlyMap<string, readonly string[]> | null, gateEnabled: boolean): void {
		this.#d.privilegeLedger.setApprovals(approvals, gateEnabled);
		this.#d.logger.logInfo(`[orchestrator] baseline de privilegios instalado (gate ${gateEnabled ? "ACTIVO" : "sólo auditoría"}).`);
	}

	/**
	 * Declara qué apps quedaron **dormidas** en este arranque: configuradas y sanas, pero
	 * fuera del allowlist de carga (`ADC_LOAD_APPS`). Se llama una sola vez desde el kernel,
	 * antes de cargar las capas de apps.
	 *
	 * Sin esto, un boot dirigido rompe la status page: las apps ausentes no son ni una baja
	 * manual (no están en el disabled-set) ni un `pending` (no son nuevas), así que
	 * `memberState` las cuenta como FALLO pasada la gracia y el modules-manager llega a abrir
	 * incidentes automáticos por ellas.
	 */
	setDormantApps(bases: Iterable<string>): void {
		this.#dormantApps.clear();
		for (const base of bases) this.#dormantApps.add(base);
		if (this.#dormantApps.size > 0) {
			this.#d.logger.logInfo(`[orchestrator] ${this.#dormantApps.size} app(s) dormidas por el allowlist de carga (no cuentan como caída).`);
		}
	}

	/** `true` si la app (nombre base o `base:config`) quedó fuera del allowlist de carga. */
	isAppDormant(name: string): boolean {
		return this.#dormantApps.has(name.split(":")[0]);
	}

	/**
	 * Services que quedaron dormidos **por arrastre**: `ADC_LOAD_APPS` sólo nombra apps, pero un
	 * service se carga porque alguien lo declara, así que dejar dormida a la única app que lo
	 * consume hace que nunca se cargue. Sin esto, {@link setDormantApps} protege a las apps y el
	 * boot dirigido igual abre incidentes automáticos por sus backs (`service:...`).
	 *
	 * Un service cuenta como dormido cuando tiene consumidores y TODOS están dormidos. Los que no
	 * tienen ninguno se cargan por su cuenta (`kernelMode`) y su ausencia sí es una caída.
	 *
	 * Se resuelve por punto fijo creciente porque la dormancia se propaga en cadena (app dormida →
	 * su service → el service que sólo aquél consumía). Partir del conjunto vacío y sólo agregar
	 * deja fuera un ciclo de services que se consumieran entre sí; es deliberado: el cargador no
	 * puede resolver ese ciclo, así que ahí la ausencia es un fallo de verdad y hay que reportarla.
	 *
	 * @param candidates services bajo evaluación (los miembros de los grupos amigables).
	 */
	async #resolveDormantServices(candidates: Iterable<string>): Promise<Set<string>> {
		const dormant = new Set<string>();
		if (this.#dormantApps.size === 0) return dormant;

		const graph = await this.#ensureGraph();
		const loaded = new Set(this.#d.registry.getModuleNames("service"));
		// Un service cargado no es dormido aunque sus consumidores lo estén: está ahí, y si más
		// tarde desaparece es una caída real.
		const pending = [...candidates].filter((svc) => !loaded.has(svc));

		let changed = true;
		while (changed) {
			changed = false;
			for (const svc of pending) {
				if (dormant.has(svc)) continue;
					// Sólo consumidores REQUERIDOS: quien lo declaró `optional` funciona sin él por
				// definición, así que su presencia no convierte la ausencia en caída. Sin esto,
				// un service que sólo consume de verdad una app dormida sigue reportándose caído
				// porque algún kernelMode lo declara opcionalmente (EmailService ← Identity /
				// Notification). Mismo criterio que usa la cascada de `disable`.
				const { apps, services } = graph.directDependents("service", svc, { includeOptional: false });
				const consumers = apps.length + services.filter((s) => s !== svc).length;
				if (consumers === 0) continue;
				const appsDormant = apps.every((app) => this.#dormantApps.has(app.split(":")[0]));
				const servicesDormant = services.every((s) => s === svc || dormant.has(s));
				if (appsDormant && servicesDormant) {
					dormant.add(svc);
					changed = true;
				}
			}
		}
		return dormant;
	}

	availabilitySnapshot(): Record<string, { messageKey?: string; since?: number }> {
		const result: Record<string, { messageKey?: string }> = {};
		for (const entry of this.#d.disabledRegistry.list()) {
			// Un pending nunca fue parte de la superficie pública: no es "mantenimiento".
			if (entry.type !== "app" || entry.pending) continue;
			const base = entry.name.split(":")[0];
			result[base] = { messageKey: entry.messageKey };
		}
		return result;
	}

	// ── Boot: aplicar estado persistido ─────────────────────────────────────────

	/**
	 * Aplica el estado persistido (mongo) al disabled-set en memoria. Llamado por el
	 * preset en su `start()`. Para apps esto basta (cargan después de los services);
	 * para services ya levantados, el preset invoca además `reconcile()`.
	 */
	applyPersistedStatus(items: PersistedStatusItem[]): void {
		for (const item of items) {
			if (item.enabled) {
				this.#d.disabledRegistry.remove(item.type, item.name);
			} else {
				this.#d.disabledRegistry.add({
					type: item.type,
					name: item.name,
					messageKey: item.messageKey,
					cascadeRoot: item.cascadeRoot,
					pending: item.pending || undefined,
					filePath: item.filePath,
				});
				const label = item.pending ? "PENDIENTE de lanzamiento (nunca ejecutado)" : "marcado inactivo";
				this.#d.logger.logWarn(`[orchestrator] ${item.type} '${item.name}' ${label} desde estado persistido.`);
			}
		}
	}

	/**
	 * Tras el boot: detiene services/providers/utilities que estén levantados pero
	 * deban quedar inactivos según el estado persistido (apps ya fueron salteadas por
	 * el loader). Emite advertencias en logs.
	 */
	async reconcile(): Promise<void> {
		for (const entry of this.#d.disabledRegistry.list()) {
			if (entry.type === "app") continue;
			const stillLoaded = this.#d.registry.getModuleNames(entry.type).includes(entry.name);
			if (!stillLoaded) continue;
			this.#d.logger.logWarn(`[orchestrator] Reconciliando: deteniendo ${entry.type} '${entry.name}' (debe estar inactivo).`);
			await this.#stopNode({ type: entry.type, name: entry.name }, entry.messageKey);
		}
	}

	// ── Disable / Enable ─────────────────────────────────────────────────────────

	/** Deshabilita un módulo y cascadea el corte a sus dependientes (dependientes primero). */
	async disable(type: OrchestratorLayer, name: string, opts: DisableOptions = {}): Promise<string[]> {
		// Un pendiente nunca se ejecutó: no hay nada que deshabilitar (y hacerlo pisaría
		// su filePath, dejándolo imposible de lanzar).
		if (this.#pendingEntry(type, name)) {
			throw new Error(`'${name}' está pendiente de lanzamiento (nunca se ejecutó): no se puede deshabilitar.`);
		}
		// Una ui-library no se detiene (rompería a todos sus consumidores): se recompila.
		if (type === "app" && (await this.#isLibraryApp(name))) {
			throw new Error(`'${name}' es una ui-library: no se puede deshabilitar. Usá "Recompilar" tras un git pull.`);
		}
		const plan = await this.#buildStopPlan(type, name);
		this.#d.logger.logInfo(
			`[orchestrator] disable ${type}:${name} → plan de corte (${plan.length}): ${plan.map((n) => `${n.type}:${n.name}`).join(", ")}`
		);
		const affected: string[] = [];
		for (const node of plan) {
			this.#d.disabledRegistry.add({ type: node.type, name: node.name, messageKey: opts.messageKey, cascadeRoot: name });
			await this.#stopNode(node, opts.messageKey);
			affected.push(`${node.type}:${node.name}`);
		}
		return affected;
	}

	/**
	 * `true` si `filePath` cuelga de una raíz legítima para esa capa: `src/<capa>s` o
	 * `presets/<topic>/<capa>s`. Estructural a propósito (sin tocar el FS): la lista de
	 * topics cambia en runtime cuando aparece un preset nuevo, y un chequeo que dependa
	 * de esa lista rechazaría justo el caso que el lanzamiento manual existe para cubrir.
	 */
	#isInsideLayerRoot(type: OrchestratorLayer, filePath: string): boolean {
		const layerDir = `${type}s`; // app→apps, service→services, provider→providers, utility→utilities
		if (isInsideBase(path.join(this.#d.srcPath, layerDir), filePath)) return true;
		const rel = path.relative(this.#d.presetsPath, path.resolve(filePath));
		if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
		const [topic, layer] = rel.split(path.sep);
		return Boolean(topic) && topic !== ".." && layer === layerDir;
	}

	/** Entrada pendiente para `type:name` (app-aware), o undefined. */
	#pendingEntry(type: OrchestratorLayer, name: string): DisabledEntry | undefined {
		const entry = type === "app" ? this.#d.disabledRegistry.getApp(name) : this.#d.disabledRegistry.get(type, name);
		return entry?.pending ? entry : undefined;
	}

	/**
	 * Lanza un módulo PENDIENTE (detectado en runtime, nunca ejecutado): primera y única
	 * carga de su código, aprobada manualmente. Se retira del disabled-set ANTES de cargar
	 * (los loaders saltean pendings); si la carga lanza, vuelve a pendiente (visible y
	 * reintenable). Nota: los loaders absorben la mayoría de los errores (logs/breaker),
	 * en cuyo caso el módulo queda como fallo normal de carga, no como pendiente.
	 */
	async #launchPending(entry: DisabledEntry): Promise<string[]> {
		if (!entry.filePath) {
			throw new Error(`'${entry.name}' está pendiente pero sin filePath registrado: no se puede lanzar (revisá su origen en disco).`);
		}
		// Anti path-traversal: `filePath` llega desde el estado persistido en mongo
		// (`applyPersistedStatus`) y de ahí va directo a un `import()`, que es ejecución de
		// código. Sin contención (la misma que ya exige el loader de kernel-services), una
		// fila alterada en la base ejecuta cualquier archivo del disco con los privilegios
		// del kernel.
		if (!this.#isInsideLayerRoot(entry.type, entry.filePath)) {
			throw new Error(
				`[orchestrator] '${entry.name}' apunta fuera de las raíces de ${entry.type} permitidas, lanzamiento abortado: ${entry.filePath}`
			);
		}
		this.#d.disabledRegistry.remove(entry.type, entry.name);
		this.#invalidateGraph(); // su config ya está en disco: el grafo debe verlo
		this.#d.logger.logWarn(`[orchestrator] Lanzando módulo pendiente ${entry.type}:${entry.name} (${entry.filePath}).`);
		try {
			if (entry.type === "app") {
				await this.#d.appLoader.loadApp(entry.filePath);
			} else {
				await this.#d.registrar.registerByPath(entry.type, entry.filePath);
			}
		} catch (e) {
			this.#d.disabledRegistry.add(entry);
			throw e;
		}
		return [`${entry.type}:${entry.name}`];
	}

	/** Re-habilita un módulo y su grupo de cascada (root primero, luego dependientes). */
	async enable(type: OrchestratorLayer, name: string): Promise<string[]> {
		// Pendiente: no es un re-enable sino el LANZAMIENTO inicial aprobado.
		const pending = this.#pendingEntry(type, name);
		if (pending) return this.#launchPending(pending);
		// Grupo de cascada: el target + lo que cayó por su culpa.
		const group = this.#d.disabledRegistry
			.list()
			.filter((e) => e.cascadeRoot === name || (e.type === type && e.name === name));
		// Orden de arranque: root primero (dependencias antes que dependientes).
		const ordered = [
			...group.filter((e) => e.type === type && e.name === name),
			...group.filter((e) => !(e.type === type && e.name === name)),
		];
		const affected: string[] = [];
		for (const entry of ordered) {
			// Recargar ANTES de sacar el gate: mientras `#startNode` recompila la app, el
			// disabled-set la mantiene en mantenimiento (el cliente sigue redirigido y no
			// ve el bundle viejo). Recién al terminar el rebuild se levanta el gate. El
			// reload no consulta el disabled-set, así que seguir gateado no lo bloquea.
			await this.#startNode({ type: entry.type, name: entry.name });
			this.#d.disabledRegistry.remove(entry.type, entry.name);
			affected.push(`${entry.type}:${entry.name}`);
		}
		// Re-conectar a los dependientes OPCIONALES que siguieron corriendo (no se
		// cascadearon): su integración con `name` se perdió al detenerlo y ahora hay
		// una instancia nueva. Los dependientes requeridos ya se re-arrancaron arriba.
		await this.#notifyDependentsRestored(type, name);
		this.#d.logger.logOk(`[orchestrator] enable ${type}:${name} → re-habilitados: ${affected.join(", ")}`);
		return affected;
	}

	/**
	 * Notifica `onDependencyRestored(name)` a los dependientes OPCIONALES de `name`
	 * (los que no entran en la cascada y por tanto siguieron vivos con una referencia
	 * obsoleta). Cada notificación va aislada: un fallo no corta al resto.
	 */
	async #notifyDependentsRestored(type: OrchestratorLayer, name: string): Promise<void> {
		if (type === "app") return;
		const all = await this.#collectDirectDependents(type, name, true);
		const required = await this.#collectDirectDependents(type, name, false);
		const reqApps = new Set(required.apps);
		const reqServices = new Set(required.services);
		const apps = all.apps.filter((a) => !reqApps.has(a));
		const services = all.services.filter((s) => !reqServices.has(s));
		for (const inst of apps) await this.#notifyRestored(this.#getAppSafe(inst), name, `app:${inst}`);
		for (const svc of services) await this.#notifyRestored(this.#getServiceSafe(svc), name, `service:${svc}`);
	}

	#getAppSafe(instanceName: string): NotifiableModule | null {
		try {
			return this.#d.registry.getApp(instanceName) as unknown as NotifiableModule;
		} catch {
			return null;
		}
	}

	#getServiceSafe(name: string): NotifiableModule | null {
		try {
			return this.#d.registry.getService<NotifiableModule>(name);
		} catch {
			return null;
		}
	}

	async #notifyRestored(instance: NotifiableModule | null, depName: string, label: string): Promise<void> {
		if (typeof instance?.onDependencyRestored !== "function") return;
		try {
			await instance.onDependencyRestored(depName);
			this.#d.logger.logOk(`[orchestrator] ${label} re-conectó dependencia '${depName}'`);
		} catch (e) {
			this.#d.logger.logError(`[orchestrator] ${label}.onDependencyRestored('${depName}') falló: ${e}`);
		}
	}

	async restart(type: OrchestratorLayer, name: string): Promise<void> {
		await this.disable(type, name);
		await this.enable(type, name);
	}

	// ── Recarga desde disco (git pull) ───────────────────────────────────────────

	async reloadFromDisk(target: ReloadTarget): Promise<ReloadReport> {
		// Los configs pudieron cambiar tras el git pull: reconstruir el grafo.
		this.#invalidateGraph();
		const report: ReloadReport = { reloaded: [], failed: [] };
		const attempt = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
			try {
				await fn();
				report.reloaded.push(label);
			} catch (e) {
				report.failed.push({ name: label, error: (e as Error)?.message ?? String(e) });
				this.#d.logger.logError(`[orchestrator] reload ${label}: ${e}`);
			}
		};
		if ("type" in target) {
			await attempt(`${target.type}:${target.name}`, () => this.#reloadModuleOrApp(target.type, target.name));
			return report;
		}
		const prefix = "preset" in target ? path.join(this.#d.presetsPath, target.preset) : path.resolve(process.cwd(), "src");
		this.#d.logger.logInfo(`[orchestrator] reloadFromDisk: ${"preset" in target ? `preset ${target.preset}` : "core"} (${prefix})`);

		for (const type of ["provider", "utility", "service"] as ModuleType[]) {
			for (const moduleName of await this.#moduleNamesUnderPath(type, prefix)) {
				if (this.#d.disabledRegistry.has(type, moduleName)) continue;
				await attempt(`${type}:${moduleName}`, () => this.#d.dependencyReloader.reloadByName(type, moduleName));
			}
		}
		// Recargar apps cuya fuente vive bajo el prefijo y no estén deshabilitadas.
		// Las ui-libraries se RECOMPILAN en su lugar (no se recargan como app: rompería consumidores).
		for (const instanceName of this.#d.appLoader.instanceNames) {
			if (this.#d.disabledRegistry.hasApp(instanceName)) continue;
			const filePath = this.#d.appLoader.findFilePathByInstance(instanceName);
			if (!filePath || !isInsideBase(prefix, filePath)) continue;
			if (await this.#isLibraryApp(instanceName)) {
				await attempt(`app:${instanceName}`, async () => {
					const res = await this.rebuildLibrary(instanceName);
					if (!res.rebuilt) throw new Error(res.error ?? "rebuild falló");
				});
			} else {
				await attempt(`app:${instanceName}`, () => this.#d.appLoader.reloadAppByInstanceName(instanceName));
			}
		}
		return report;
	}

	/**
	 * Módulos cuya fuente vive bajo un target de git (core o un preset): lo que una
	 * recarga tras `git pull` tocaría. Sólo lectura (para previews de deploy).
	 */
	async modulesUnderTarget(target: { preset: string } | { core: true }): Promise<TargetModules> {
		const prefix = "preset" in target ? path.join(this.#d.presetsPath, target.preset) : path.resolve(process.cwd(), "src");
		const out: TargetModules = {
			services: await this.#moduleNamesUnderPath("service", prefix),
			providers: await this.#moduleNamesUnderPath("provider", prefix),
			utilities: await this.#moduleNamesUnderPath("utility", prefix),
			apps: [],
			libraries: [],
		};
		for (const instanceName of this.#d.appLoader.instanceNames) {
			const filePath = this.#d.appLoader.findFilePathByInstance(instanceName);
			if (!filePath || !isInsideBase(prefix, filePath)) continue;
			if (await this.#isLibraryApp(instanceName)) out.libraries.push(instanceName);
			else out.apps.push(instanceName);
		}
		return out;
	}

	/**
	 * Plan de corte en seco (dry-run): el módulo + todos los dependientes que caerían
	 * en cascada, en orden de corte (`type:name`, dependientes primero). No muta nada.
	 */
	async previewDisable(type: OrchestratorLayer, name: string): Promise<string[]> {
		const plan = await this.#buildStopPlan(type, name);
		return plan.map((n) => `${n.type}:${n.name}`);
	}

	// ── Snapshot para la UI ──────────────────────────────────────────────────────

	async snapshot(): Promise<ModuleSnapshotItem[]> {
		const graph = await this.#ensureGraph();
		const items: ModuleSnapshotItem[] = [];

		for (const type of ["service", "provider", "utility"] as ModuleType[]) {
			// Deduplicar por instancia: "mongo" y "object/mongo" son alias del mismo
			// provider (mismo objeto), no dos módulos distintos. Se muestra uno solo.
			const canonicalByInstance = this.#canonicalNamesByInstance(type);
			const disabledNames = this.#d.disabledRegistry.list().filter((e) => e.type === type).map((e) => e.name);
			// Un service dormido por arrastre no está cargado ni deshabilitado, así que no aparece
			// por ninguna de las dos vías: sin agregarlo, el panel lo omite y parece que el módulo
			// desapareció del árbol. Es el mismo motivo por el que se agregan las apps dormidas.
			const dormantServices = type === "service" ? await this.#resolveDormantServices(graph.names("service")) : new Set<string>();
			for (const name of new Set([...canonicalByInstance, ...disabledNames, ...dormantServices])) {
				const entry = this.#d.disabledRegistry.get(type, name);
				items.push({
					type,
					name,
					state: this.#stateOf(entry, dormantServices.has(name)),
					unavailable: type === "service" && !!entry && !entry.pending,
					messageKey: entry?.messageKey,
					cascadeRoot: entry?.cascadeRoot,
					uiName: graph.uiNameOf(type, name),
					pendingPreset: entry?.pending ? this.#presetOf(entry.filePath) : undefined,
					dependents: await this.#collectDirectDependents(type, name),
				});
			}
		}

		const appNames = new Set([
			...this.#d.appLoader.instanceNames,
			...this.#d.disabledRegistry.list().filter((e) => e.type === "app").map((e) => e.name),
			// Las dormidas no están en `instanceNames` (no se cargaron): sin agregarlas, el panel
			// no las mostraría y parecerían haber desaparecido del árbol.
			...this.#dormantApps,
		]);
		for (const name of appNames) {
			const entry = this.#d.disabledRegistry.getApp(name);
			items.push({
				type: "app",
				name,
				state: this.#stateOf(entry, this.#dormantApps.has(name.split(":")[0])),
				library: await this.#isLibraryApp(name),
				messageKey: entry?.messageKey,
				cascadeRoot: entry?.cascadeRoot,
				uiName: graph.uiNameOf("app", name.split(":")[0]),
				pendingPreset: entry?.pending ? this.#presetOf(entry.filePath) : undefined,
				dependents: { apps: [], services: [] },
			});
		}
		return items;
	}

	#stateOf(entry: DisabledEntry | undefined, dormant = false): ModuleSnapshotItem["state"] {
		if (entry) return entry.pending ? "pending" : "disabled";
		return dormant ? "dormant" : "running";
	}

	/** Preset del que proviene un path (primer segmento bajo `presets/`), o null (core). */
	#presetOf(filePath?: string): string | null {
		if (!filePath) return null;
		const rel = path.relative(this.#d.presetsPath, filePath);
		if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
		return rel.split(path.sep)[0] ?? null;
	}

	/**
	 * Disponibilidad agregada por grupo amigable (`uiName`) para la status page pública.
	 * Combina frente (apps) y back (services); "down" = miembros dados de baja vía
	 * modules-manager (disabled-set). No expone nombres internos.
	 */
	/** Nombre amigable (`uiName`) declarado por una app (por su nombre base), o undefined. */
	async uiNameForApp(base: string): Promise<string | undefined> {
		const graph = await this.#ensureGraph();
		return graph.uiNameOf("app", base);
	}

	async friendlyAvailability(): Promise<FriendlyGroupState[]> {
		const graph = await this.#ensureGraph();
		// Baja manual (disabled-set) vs. FALLO (configurado pero no cargado: no arrancó o se cayó).
		const disabledAppBases = new Set(Object.keys(this.availabilitySnapshot()));
		const loadedServices = new Set(this.#d.registry.getModuleNames("service"));
		// Una app deshabilitada SIGUE en instanceNames (no se descarga, el gate la redirige);
		// por eso la baja manual se chequea antes que la ausencia (= fallo real).
		const loadedAppBases = new Set(this.#d.appLoader.instanceNames.map((i) => i.split(":")[0]));
		// Margen de arranque: durante el boot las apps/services aún no cargaron, así que un
		// módulo "ausente" sólo cuenta como FALLO si ya se lo vio cargado alguna vez (se cayó)
		// o si ya pasó el período de gracia (no levantó). Evita un aluvión de falsos positivos.
		const now = Date.now();
		if (this.#failureGraceUntil === 0) this.#failureGraceUntil = now + FAILURE_GRACE_MS;
		const graceOver = now >= this.#failureGraceUntil;
		// "unknown" = ausente dentro de la gracia: no se afirma ni caída ni recuperación.
		const memberState = (member: string, loaded: boolean): "up" | "failed" | "unknown" => {
			if (loaded) {
				this.#everLoaded.add(member);
				this.#absentSince.delete(member);
				return "up";
			}
			// Ausencia sin confirmar: durante una recarga (deploy, re-enable, hot reload) el
			// módulo desaparece del registry unos segundos. Se espera a que la ausencia
			// PERSISTA antes de llamarla caída; mientras tanto es "unknown" (ni fallo ni alta).
			const since = this.#absentSince.get(member);
			if (since === undefined) {
				this.#absentSince.set(member, now);
				return "unknown";
			}
			if (now - since < ABSENCE_CONFIRM_MS) return "unknown";
			return graceOver || this.#everLoaded.has(member) ? "failed" : "unknown";
		};
		const groups = graph.friendlyGroups();
		// Los candidatos son los backs de los grupos: es exactamente el conjunto que este chequeo
		// puede llegar a declarar caído.
		const dormantServices = await this.#resolveDormantServices([...groups.values()].flatMap((m) => m.services));

		const out: FriendlyGroupState[] = [];
		for (const [name, members] of groups) {
			const hasFront = members.apps.length > 0;
			const failed: string[] = [];
			const unknown: string[] = [];
			const downApps: string[] = [];
			let downFronts = 0;
			let downBacks = 0;
			// Services primero: si algún back del grupo está caído/deshabilitado, las apps
			// del grupo tampoco están operativas (criterio "por grupo amigable" de `downApps`).
			for (const svc of members.services) {
				const svcEntry = this.#d.disabledRegistry.get("service", svc);
				if (svcEntry?.pending) continue;
				// Dormido por arrastre de una app dormida: su ausencia es una decisión local de
				// este arranque, no una caída. Mismo trato (y mismo olvido del reloj de ausencia)
				// que las apps dormidas más abajo.
				if (!loadedServices.has(svc) && dormantServices.has(svc)) {
					this.#absentSince.delete(`service:${svc}`);
					continue;
				}
				// Baja manual: su ausencia es intencional, así que se olvida el reloj de ausencia
				// (al re-habilitarlo vuelve a contar desde cero, no arrastra el tiempo apagado).
				if (svcEntry) {
					downBacks++;
					this.#absentSince.delete(`service:${svc}`);
				} else {
					const state = memberState(`service:${svc}`, loadedServices.has(svc));
					if (state === "failed") {
						downBacks++;
						failed.push(`service:${svc}`);
					} else if (state === "unknown") unknown.push(`service:${svc}`);
				}
			}
			for (const base of members.apps) {
				// Pendiente de lanzamiento: nunca fue parte de la plataforma, no cuenta como caída/fallo.
				if (this.#d.disabledRegistry.getApp(base)?.pending) continue;
				// Dormida por el allowlist de carga de este arranque: su ausencia es una
				// decisión local, no una caída. Se olvida el reloj de ausencia por el mismo
				// motivo que en la baja manual (un boot completo posterior no arrastra el tiempo
				// que estuvo fuera).
				if (this.#dormantApps.has(base)) {
					this.#absentSince.delete(`app:${base}`);
					continue;
				}
				if (disabledAppBases.has(base)) {
					downFronts++;
					this.#absentSince.delete(`app:${base}`);
				} else {
					const state = memberState(`app:${base}`, loadedAppBases.has(base));
					if (state === "failed") {
						downFronts++;
						failed.push(`app:${base}`);
					} else if (state === "unknown") unknown.push(`app:${base}`);
					if (state === "failed" || downBacks > 0) downApps.push(base);
				}
			}
			const down = downFronts + downBacks;
			// Disponible = queda al menos un frente arriba (o, sin frente, algún back arriba).
			const available = hasFront ? members.apps.length - downFronts > 0 : members.services.length - downBacks > 0;
			// Baja MANUAL (deshabilitado) ≠ caída: si no hay fallos reales, es "mantenimiento", no "no disponible".
			let state: FriendlyGroupState["state"];
			if (down === 0) state = "ok";
			else if (failed.length === 0) state = "maintenance";
			else state = available ? "degraded" : "down";
			out.push({ name, hasFront, total: members.apps.length + members.services.length, down, failed, unknown, downApps, state });
		}
		// Orden estable: grupos con frente primero, luego alfabético (back-only como "Core" al final).
		out.sort((a, b) => Number(b.hasFront) - Number(a.hasFront) || a.name.localeCompare(b.name));
		return out;
	}

	/**
	 * Nombres canónicos (uno por instancia) de un tipo de módulo, deduplicando alias
	 * que apuntan al mismo objeto (p.ej. `mongo` ↔ `object/mongo`). Prefiere el nombre
	 * con `/` (el que usan los config.json) como canónico.
	 */
	#canonicalNamesByInstance(type: ModuleType): string[] {
		const byInstance = new Map<object, string>();
		for (const name of this.#d.registry.getModuleNames(type)) {
			for (const uniqueKey of this.#d.registry.getUniqueKeysByName(type, name)) {
				const inst = this.#d.registry.getInstanceByUniqueKey(type, uniqueKey);
				if (!inst) continue;
				const current = byInstance.get(inst);
				if (!current || this.#preferCanonical(name, current) === name) byInstance.set(inst, name);
			}
		}
		return [...new Set(byInstance.values())];
	}

	/** Prefiere el nombre "completo" (con `/`, p.ej. `object/mongo`) o el más largo. */
	#preferCanonical(a: string, b: string): string {
		const aSlash = a.includes("/");
		const bSlash = b.includes("/");
		if (aSlash !== bSlash) return aSlash ? a : b;
		return a.length >= b.length ? a : b;
	}

	// ── Internos ─────────────────────────────────────────────────────────────────

	async #buildStopPlan(type: OrchestratorLayer, name: string): Promise<StopNode[]> {
		const order: StopNode[] = [];
		const visited = new Set<string>();
		const visit = async (t: OrchestratorLayer, n: string): Promise<void> => {
			const key = `${t}:${n}`;
			if (visited.has(key)) return;
			visited.add(key);
			// Cascada: NO arrastrar dependientes opcionales (siguen corriendo aunque caiga su dep).
			const deps = await this.#collectDirectDependents(t, n, false);
			for (const app of deps.apps) await visit("app", app);
			for (const svc of deps.services) await visit("service", svc);
			order.push({ type: t, name: n });
		};
		await visit(type, name);
		return order;
	}

	/**
	 * Dependientes directos desde el grafo de configs (completo: incluye kernel
	 * services). Mapea nombres de carpeta de app → instancias en ejecución y filtra
	 * services a los efectivamente cargados.
	 */
	async #collectDirectDependents(
		type: OrchestratorLayer,
		name: string,
		includeOptional = true
	): Promise<{ apps: string[]; services: string[] }> {
		if (type === "app") return { apps: [], services: [] };
		const graph = await this.#ensureGraph();
		const { apps: appBaseNames, services: serviceNames } = graph.directDependents(type, name, { includeOptional });

		const running = this.#d.appLoader.instanceNames;
		const apps = new Set<string>();
		for (const base of appBaseNames) {
			for (const inst of running) {
				if (inst === base || inst.split(":")[0] === base) apps.add(inst);
			}
		}

		const loadedServices = new Set(this.#d.registry.getModuleNames("service"));
		const services = serviceNames.filter((s) => loadedServices.has(s) && s !== name);
		return { apps: [...apps], services };
	}

	async #stopNode(node: StopNode, messageKey?: string): Promise<void> {
		const { logger } = this.#d;
		try {
			if (node.type === "app") {
				// La app NO se descarga ni se baja su dev-server (eso daba "connection refused"):
				// sigue servida y el gate cliente la redirige a la página de mantenimiento de
				// adc-error al detectarla en `availabilitySnapshot` (este disabled-set). El
				// disabled-set ya fue poblado por disable() antes de llamar acá.
				logger.logInfo(`[orchestrator] app ${node.name} marcada en mantenimiento.`);
				return;
			}
			if (node.type === "service") {
				// Orden prolijo: 1) endpoints → 503, 2) stop del servicio, 3) liberar
				// providers/utilities exclusivos (cierra su conexión, p.ej. mongo).
				this.#endpointController()?.setOwnerUnavailable(this.#d.platformCap, node.name, true, this.#messageFor(messageKey));
				await this.#unloadAllAliases("service", node.name);
				await this.#releaseExclusiveDeps(node.name);
			} else {
				await this.#unloadAllAliases(node.type, node.name);
			}
			logger.logOk(`[orchestrator] detenido ${node.type}:${node.name}`);
		} catch (e) {
			logger.logError(`[orchestrator] error deteniendo ${node.type}:${node.name}: ${e}`);
		}
	}

	/** Descarga TODAS las instancias de los nombres-alias que comparten la instancia de `name`. */
	async #unloadAllAliases(type: ModuleType, name: string): Promise<void> {
		for (const alias of this.#instanceAliasNames(type, name)) {
			await this.#d.registry.unloadModulesByName(type, this.#d.kernelKey, alias);
		}
	}

	/** Nombres que apuntan a la misma instancia que `name` (p.ej. `object/mongo` y `mongo`). */
	#instanceAliasNames(type: ModuleType, name: string): string[] {
		const target = new Set<object>();
		for (const uk of this.#d.registry.getUniqueKeysByName(type, name)) {
			const inst = this.#d.registry.getInstanceByUniqueKey(type, uk);
			if (inst) target.add(inst);
		}
		if (target.size === 0) return [name];
		const names = new Set<string>([name]);
		for (const n of this.#d.registry.getModuleNames(type)) {
			for (const uk of this.#d.registry.getUniqueKeysByName(type, n)) {
				const inst = this.#d.registry.getInstanceByUniqueKey(type, uk);
				if (inst && target.has(inst)) names.add(n);
			}
		}
		return [...names];
	}

	/**
	 * Libera providers/utilities declarados por un servicio que ya no tenga ningún
	 * otro consumidor en ejecución (cierra conexiones, p.ej. la db). Conservador: si
	 * algún otro app/servicio cargado lo usa, NO lo toca (evita cortar shared).
	 */
	async #releaseExclusiveDeps(serviceName: string): Promise<void> {
		const graph = await this.#ensureGraph();
		const runningServices = new Set(this.#d.registry.getModuleNames("service"));
		const runningAppBases = new Set(this.#d.appLoader.instanceNames.map((i) => i.split(":")[0]));
		for (const dep of graph.declaredDependencies("service", serviceName)) {
			if (dep.layer === "service") continue; // los services dependientes ya se cascadean aparte
			const { apps, services } = graph.directDependents(dep.layer, dep.name);
			const otherConsumer =
				apps.some((a) => runningAppBases.has(a)) || services.some((s) => s !== serviceName && runningServices.has(s));
			if (otherConsumer) continue;
			this.#d.logger.logInfo(`[orchestrator] liberando ${dep.layer} exclusivo '${dep.name}' de ${serviceName}`);
			await this.#unloadAllAliases(dep.layer, dep.name);
		}
	}

	async #startNode(node: StopNode): Promise<void> {
		const { dependencyReloader, logger } = this.#d;
		try {
			if (node.type === "app") {
				// Re-habilitar recarga la app desde disco (rebuild + re-registro de UI/i18n),
				// así un git pull intermedio se refleja al encenderla. Las ui-libraries se
				// RECOMPILAN en su lugar (recargarlas como app rompería consumidores), igual
				// que en reloadFromDisk. El disabled-set ya fue limpiado por enable().
				if (await this.#isLibraryApp(node.name)) {
					await this.rebuildLibrary(node.name).catch((e) => logger.logError(`[orchestrator] rebuild library ${node.name}: ${e}`));
				} else {
					await this.#d.appLoader
						.reloadAppByInstanceName(node.name)
						.catch((e) => logger.logError(`[orchestrator] reload app ${node.name}: ${e}`));
				}
				logger.logOk(`[orchestrator] app ${node.name} recargada y re-habilitada (sale de mantenimiento).`);
				return;
			}
			if (node.type === "service") {
				this.#endpointController()?.setOwnerUnavailable(this.#d.platformCap, node.name, false);
			}
			await dependencyReloader.reloadByName(node.type, node.name);
			logger.logOk(`[orchestrator] re-habilitado ${node.type}:${node.name}`);
		} catch (e) {
			logger.logError(`[orchestrator] error re-habilitando ${node.type}:${node.name}: ${e}`);
		}
	}

	async #reloadModuleOrApp(type: ModuleType, name: string): Promise<void> {
		// Si la "app" llega como type module por error, igual intentamos reload de módulo.
		await this.#d.dependencyReloader.reloadByName(type, name);
	}

	/**
	 * Módulos CARGADOS de una capa cuya fuente vive bajo `prefix`. La ubicación sale del grafo y no
	 * del `fileToUniqueKeyMap` del registry, que arranca vacío y deja fuera lo que levantó el boot
	 * (ver `DependencyGraph.namesUnderPath`).
	 */
	async #moduleNamesUnderPath(type: ModuleType, prefix: string): Promise<string[]> {
		const graph = await this.#ensureGraph();
		const base = (name: string): string => (name.includes("/") ? name.split("/").pop()! : name);
		// El grafo nombra al módulo por su carpeta; el registry, por los alias de sus consumidores
		// (`mongo`, `object/mongo`, `mongo-provider`). Se cruzan por basename y se devuelve el
		// nombre canónico del registry, que es el que entiende `reloadByName`.
		const underPath = new Set(graph.namesUnderPath(type, prefix).map(base));
		return this.#canonicalNamesByInstance(type).filter((name) => underPath.has(base(name)));
	}

	// Los dos controladores de abajo reciben la `platform:infra` del kernel, así que se
	// resuelven por identidad pinneada en boot y no por nombre: la resolución por nombre
	// desempata por longitud de `uniqueKey` y es ganable por un módulo homónimo.
	#endpointController(): EndpointUnavailabilityController | null {
		try {
			const svc = this.#d.registry.getPlatformService<EndpointUnavailabilityController>("EndpointManagerService");
			return typeof svc?.setOwnerUnavailable === "function" ? svc : null;
		} catch {
			return null;
		}
	}

	#uiController(): UIController | null {
		try {
			const svc = this.#d.registry.getPlatformService<UIController>("UIFederationService");
			return typeof svc?.rebuildModule === "function" ? svc : null;
		} catch {
			return null;
		}
	}

	/** Lee `uiModule` (framework/name) del config de una app cargada, o null. */
	async #readAppUiConfig(instanceName: string): Promise<{ framework?: string; name?: string } | null> {
		const filePath = this.#d.appLoader.findFilePathByInstance(instanceName);
		if (!filePath) return null;
		const dir = path.dirname(filePath);
		for (const file of ["config.json", "default.json"]) {
			try {
				const cfg = safeParseJson(await fs.readFile(path.join(dir, file), "utf-8"), moduleConfigCheck);
				const uiModule = (cfg as { uiModule?: { framework?: string; name?: string } } | null)?.uiModule;
				if (uiModule) return { framework: uiModule.framework, name: uiModule.name };
			} catch {
				/* siguiente */
			}
		}
		return null;
	}

	/** Nombre de módulo UI fallback (`00-adc-ui-library:default` → `adc-ui-library`). */
	#appToModuleName(instanceName: string): string {
		return instanceName.split(":")[0].replace(/^\d+-/, "").replace(/^web-/, "");
	}

	/**
	 * `true` si la app es una ui-library: se decide por `uiModule.framework === "stencil"`
	 * en su config (autoritativo, cubre 00-adc/00-web-ui-library/-mobile sin heurística de nombre).
	 */
	async #isLibraryApp(instanceName: string): Promise<boolean> {
		const ui = await this.#readAppUiConfig(instanceName);
		return ui?.framework === "stencil";
	}

	/** Recompila una ui-library en su lugar (sin cortar a los consumidores). */
	async rebuildLibrary(instanceName: string): Promise<{ rebuilt: boolean; mode: "watch" | "static"; error?: string }> {
		const ui = await this.#readAppUiConfig(instanceName);
		const moduleName = ui?.name ?? this.#appToModuleName(instanceName);
		const controller = this.#uiController();
		if (!controller) return { rebuilt: false, mode: "static", error: "UIFederationService no disponible" };
		this.#d.logger.logInfo(`[orchestrator] recompilando ui-library ${moduleName}...`);
		return controller.rebuildModule(this.#d.platformCap, moduleName);
	}

	#messageFor(messageKey?: string): string | undefined {
		if (!messageKey) return undefined;
		return MAINTENANCE_MESSAGES[messageKey] ?? messageKey;
	}
}

/** Mensajes predefinidos de mantenimiento (espejo en la UI de adc-error). */
const MAINTENANCE_MESSAGES: Record<string, string> = {
	unavailable: "Esta aplicación no está disponible temporalmente.",
	updating: "Estamos trabajando en una actualización para esta aplicación. Actualizá este sitio más tarde para continuar donde estabas.",
	repairs: "Estamos realizando reparaciones en esta aplicación. Volvé a intentarlo en unos minutos.",
};
