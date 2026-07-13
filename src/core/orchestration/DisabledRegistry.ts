import * as path from "node:path";
import type { ModuleTypes } from "../../utils/registry/ModuleRegistry.js";

export interface DisabledEntry {
	type: ModuleTypes;
	/** Para apps es el instanceName (`adc-drive:default`) o el nombre base (`adc-drive`). */
	name: string;
	/** Clave de mensaje predefinido a mostrar en mantenimiento (apps). */
	messageKey?: string;
	/**
	 * Nombre del módulo cuya desactivación originó este corte. Cuando coincide con
	 * `name`, este módulo fue el objetivo directo; si difiere, fue colateral por
	 * cascada (se restaura al re-habilitar el root).
	 */
	cascadeRoot?: string;
	/**
	 * Módulo NUEVO detectado en runtime (watcher): su código NUNCA se ejecutó.
	 * A diferencia de un disabled común (apps siguen sirviendo tras el gate),
	 * un pending se saltea por completo en loaders y watchers hasta que un
	 * administrador lo lance desde el modules-manager (`enable`).
	 */
	pending?: boolean;
	/** Ruta del `index` detectado; permite lanzar un pending que nunca se cargó. */
	filePath?: string;
}

/**
 * Set en memoria de módulos deshabilitados en runtime. Es la fuente de verdad
 * que consultan los loaders (AppLoader/KernelServiceLoader) para NO levantar un
 * módulo que debe quedar inactivo, y el ModuleOrchestrator para reconciliar.
 *
 * Se crea ANTES que los loaders en el Kernel y se puebla al boot desde mongo
 * (vía `ModuleOrchestrator.applyPersistedStatus`, que invoca el preset
 * `adc-modules-manager`). No persiste: el preset es el dueño de la persistencia.
 */
export class DisabledRegistry {
	readonly #entries = new Map<string, DisabledEntry>();

	#key(type: ModuleTypes, name: string): string {
		return `${type}:${name}`;
	}

	add(entry: DisabledEntry): void {
		this.#entries.set(this.#key(entry.type, entry.name), entry);
	}

	remove(type: ModuleTypes, name: string): void {
		this.#entries.delete(this.#key(type, name));
	}

	has(type: ModuleTypes, name: string): boolean {
		return this.#entries.has(this.#key(type, name));
	}

	get(type: ModuleTypes, name: string): DisabledEntry | undefined {
		return this.#entries.get(this.#key(type, name));
	}

	/**
	 * App-aware: una app puede registrarse por instanceName (`app:config`) o por
	 * nombre base (`app`). Devuelve true si cualquiera de las dos formas está
	 * deshabilitada.
	 */
	hasApp(instanceName: string): boolean {
		if (this.has("app", instanceName)) return true;
		const base = instanceName.split(":")[0];
		return base !== instanceName && this.has("app", base);
	}

	getApp(instanceName: string): DisabledEntry | undefined {
		return this.get("app", instanceName) ?? this.get("app", instanceName.split(":")[0]);
	}

	list(): DisabledEntry[] {
		return [...this.#entries.values()];
	}

	/**
	 * `true` si `p` es (o cae dentro de) el directorio de un módulo pendiente.
	 * Gate para los watchers: los eventos de archivos de un pending (p.ej. mientras
	 * se termina de copiar/clonar) no deben disparar cargas.
	 */
	isPendingPath(p: string): boolean {
		for (const e of this.#entries.values()) {
			if (!e.pending || !e.filePath) continue;
			const dir = path.dirname(e.filePath);
			if (p === e.filePath || p.startsWith(dir + path.sep)) return true;
		}
		return false;
	}

	clear(): void {
		this.#entries.clear();
	}
}
