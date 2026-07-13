import * as fs from "node:fs/promises";
import * as path from "node:path";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { moduleConfigCheck } from "@common/schemas/module-config.ts";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { ModuleRegistry, ModuleType } from "../../utils/registry/ModuleRegistry.js";
import type { AppLoader } from "../apps/AppLoader.js";
import type { DisabledRegistry } from "../orchestration/DisabledRegistry.js";
import type { DetectedModuleEvent, OrchestratorLayer } from "../orchestration/types.js";

export interface ModuleDetectorDeps {
	logger: ILogger;
	registry: ModuleRegistry;
	appLoader: AppLoader;
	disabledRegistry: DisabledRegistry;
	presetsPath: string;
	isShuttingDown: () => boolean;
}

/** Evento emitido a los suscriptores (el preset modules-manager persiste/audita/notifica). */
export interface ModuleDetectionEvent extends DetectedModuleEvent {
	/** `detected`: quedó pendiente de lanzamiento; `removed`: su fuente desapareció sin haberse lanzado. */
	kind: "detected" | "removed";
}

/**
 * Maneja los `add` de los watchers: un módulo NUEVO en runtime no se ejecuta;
 * queda registrado como **pendiente** en el DisabledRegistry (con su filePath)
 * hasta que un administrador lo lance desde el modules-manager (`enable`).
 *
 * El código de un pendiente nunca se importa: la detección se limita a leer su
 * `config.json`/`default.json` para resolver el nombre.
 */
export class ModuleDetector {
	readonly #d: Readonly<ModuleDetectorDeps>;
	readonly #subscribers: Array<(e: ModuleDetectionEvent) => void> = [];

	constructor(deps: ModuleDetectorDeps) {
		this.#d = Object.freeze({ ...deps });
	}

	/** Suscribe un observador de detecciones (best-effort: un fallo no corta al resto). */
	onDetected(cb: (e: ModuleDetectionEvent) => void): void {
		this.#subscribers.push(cb);
	}

	/**
	 * Procesa la aparición de un `index` de módulo. No ejecuta nada: si es un módulo
	 * genuinamente nuevo lo deja pendiente; si pertenece a un módulo ya cargado o ya
	 * conocido, lo ignora (el hot-reload de módulos cargados va por eventos `change`).
	 */
	detect = async (type: OrchestratorLayer, indexPath: string): Promise<void> => {
		if (this.#d.isShuttingDown()) return;
		if (indexPath.includes(`${path.sep}node_modules${path.sep}`)) return;
		const dir = path.dirname(indexPath);
		if (!(await this.#isModuleRoot(dir))) {
			this.#d.logger.logDebug(`[detector] ${indexPath} no es raíz de módulo (sin package.json/config): ignorado.`);
			return;
		}
		const name = type === "app" ? path.basename(dir) : await this.#resolveModuleName(dir);
		if (this.#isLoaded(type, name)) {
			this.#d.logger.logDebug(`[detector] ${type} '${name}' ya está cargado: add ignorado (los cambios van por change/git pull).`);
			return;
		}
		const known = type === "app" ? this.#d.disabledRegistry.getApp(name) : this.#d.disabledRegistry.get(type, name);
		if (known) return; // ya pendiente o deshabilitado: nada que hacer

		this.#d.disabledRegistry.add({ type, name, pending: true, filePath: indexPath });
		this.#d.logger.logWarn(
			`[detector] Módulo NUEVO detectado en runtime: ${type} '${name}' (${indexPath}). NO se ejecuta: queda PENDIENTE de lanzamiento manual (modules-manager).`
		);
		this.#emit({ kind: "detected", type, name, filePath: indexPath, preset: this.#presetTopicOf(indexPath) });
	};

	/**
	 * Procesa un `unlink`: si el archivo era el `index` de un módulo pendiente, retira
	 * la entrada (y avisa para limpiar la persistencia). Devuelve `true` si lo era
	 * (no hay nada cargado que descargar).
	 */
	undetect = async (type: OrchestratorLayer, indexPath: string): Promise<boolean> => {
		const entry = (type === "app" ? this.#d.disabledRegistry.getApp(path.basename(path.dirname(indexPath))) : undefined) ??
			this.#findPendingByPath(type, indexPath);
		if (!entry?.pending || entry.filePath !== indexPath) return false;
		this.#d.disabledRegistry.remove(entry.type, entry.name);
		this.#d.logger.logInfo(`[detector] Módulo pendiente ${entry.type}:'${entry.name}' eliminado de disco antes de lanzarse: se retira.`);
		this.#emit({ kind: "removed", type: entry.type, name: entry.name, filePath: indexPath, preset: this.#presetTopicOf(indexPath) });
		return true;
	};

	/**
	 * `true` si un evento `change` sobre `p` NO debe disparar recarga: el archivo
	 * pertenece a un módulo pendiente (nunca aprobado) o a uno deshabilitado
	 * (recargarlo lo resucitaría por la puerta de atrás).
	 */
	isReloadBlocked = async (type: OrchestratorLayer, p: string): Promise<boolean> => {
		if (this.#d.disabledRegistry.isPendingPath(p)) return true;
		const dir = path.dirname(p);
		const name = type === "app" ? path.basename(dir) : await this.#resolveModuleName(dir);
		const entry = type === "app" ? this.#d.disabledRegistry.getApp(name) : this.#d.disabledRegistry.get(type, name);
		return !!entry;
	};

	#findPendingByPath(type: OrchestratorLayer, indexPath: string) {
		return this.#d.disabledRegistry.list().find((e) => e.type === type && e.pending && e.filePath === indexPath);
	}

	#emit(e: ModuleDetectionEvent): void {
		for (const cb of this.#subscribers) {
			try {
				cb(e);
			} catch (err) {
				this.#d.logger.logError(`[detector] suscriptor de detección falló: ${err}`);
			}
		}
	}

	/** Raíz de módulo = directorio con package.json o config (evita falsos positivos en subdirs con index). */
	async #isModuleRoot(dir: string): Promise<boolean> {
		for (const f of ["package.json", "config.json", "default.json"]) {
			try {
				await fs.access(path.join(dir, f));
				return true;
			} catch {
				/* siguiente */
			}
		}
		return false;
	}

	/** Nombre lógico del módulo: `name` de su config.json/default.json, o el nombre del directorio. */
	async #resolveModuleName(dir: string): Promise<string> {
		for (const f of ["config.json", "default.json"]) {
			try {
				const cfg = safeParseJson(await fs.readFile(path.join(dir, f), "utf-8"), moduleConfigCheck);
				const name = (cfg as { name?: string } | null)?.name;
				if (typeof name === "string" && name.length > 0) return name;
			} catch {
				/* siguiente */
			}
		}
		return path.basename(dir);
	}

	#isLoaded(type: OrchestratorLayer, name: string): boolean {
		if (type === "app") {
			return this.#d.appLoader.instanceNames.some((i) => i === name || i.split(":")[0] === name);
		}
		return this.#d.registry.getModuleNames(type as ModuleType).includes(name);
	}

	/** Topic del preset si el path vive bajo `presets/`, o null (core). */
	#presetTopicOf(p: string): string | null {
		const rel = path.relative(this.#d.presetsPath, p);
		if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
		return rel.split(path.sep)[0] ?? null;
	}
}
