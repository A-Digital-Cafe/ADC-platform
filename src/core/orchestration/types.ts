import type { ModuleType } from "../../utils/registry/ModuleRegistry.js";

/** Capa orquestable: igual que ModuleType + apps. */
export type OrchestratorLayer = ModuleType | "app";

/** Estado de un módulo para la UI del modules-manager. */
export interface ModuleSnapshotItem {
	type: OrchestratorLayer;
	/** App: instanceName; resto: nombre lógico. */
	name: string;
	/** `pending`: módulo nuevo detectado en runtime, nunca ejecutado; requiere lanzamiento manual. */
	state: "running" | "disabled" | "pending";
	/** Para services deshabilitados: sus endpoints responden 503. */
	unavailable?: boolean;
	/** App que es ui-library Stencil: no se detiene, se recompila (rebuild). */
	library?: boolean;
	messageKey?: string;
	/** Nombre del módulo que originó el corte (si fue cascada). */
	cascadeRoot?: string;
	/** Nombre amigable (grupo de status) declarado en config (`uiName`), si lo tiene. */
	uiName?: string;
	dependents: { apps: string[]; services: string[] };
}

/**
 * Disponibilidad agregada de un grupo amigable (`uiName`) para la status page pública.
 * Combina el frente (apps) y el back (services) del grupo. `down` = nº de miembros
 * dados de baja vía modules-manager.
 */
export interface FriendlyGroupState {
	name: string;
	/** `true` si el grupo tiene al menos una app (frente user-facing). */
	hasFront: boolean;
	total: number;
	down: number;
	/**
	 * Miembros caídos por FALLO (configurados pero no cargados: no arrancaron o se cayeron),
	 * NO por baja manual. Ids `type:name` (ej. `service:DriveService`). Uso interno (sampler
	 * de incidentes automáticos); nunca se expone en el payload público.
	 */
	failed: string[];
	/**
	 * Apps del grupo (nombres base) NO disponibles por caída: su front falló o algún
	 * service del grupo está caído/deshabilitado. Excluye bajas manuales de la propia
	 * app (esas viajan en `disabled` del snapshot de plataforma) y pendientes. Alimenta
	 * el `down` de `platformState()` (ocultar botones en apps-menu / adc-home).
	 */
	downApps: string[];
	/**
	 * - `ok`: todo arriba.
	 * - `maintenance`: sólo hay bajas MANUALES (deshabilitado desde modules-manager) — planificado, no es una caída.
	 * - `degraded`: hay un FALLO real pero el grupo sigue disponible (algún frente arriba).
	 * - `down`: hay un FALLO real y el grupo no está disponible.
	 */
	state: "ok" | "maintenance" | "degraded" | "down";
}

/** Item persistido en mongo (preset) y aplicado al boot. */
export interface PersistedStatusItem {
	type: OrchestratorLayer;
	name: string;
	enabled: boolean;
	messageKey?: string;
	cascadeRoot?: string;
	/** Detectado en runtime y nunca ejecutado (ver DisabledEntry.pending). */
	pending?: boolean;
	/** Ruta del `index` detectado (necesaria para poder lanzar un pending). */
	filePath?: string;
}

/** Módulo nuevo detectado en runtime (aún sin ejecutar). */
export interface DetectedModuleEvent {
	type: OrchestratorLayer;
	name: string;
	filePath: string;
	/** Topic del preset si el módulo vive bajo `presets/`, o null (core). */
	preset: string | null;
}

/** Opciones al deshabilitar. */
export interface DisableOptions {
	messageKey?: string;
	/** Quién dispara la acción (auditoría/logs). */
	actor?: string;
}

/** Objetivo de recarga desde disco tras git pull. */
export type ReloadTarget = { type: ModuleType; name: string } | { preset: string } | { core: true };
