import type { ModuleType } from "../../utils/registry/ModuleRegistry.js";

/** Capa orquestable: igual que ModuleType + apps. */
export type OrchestratorLayer = ModuleType | "app";

/** Estado de un módulo para la UI del modules-manager. */
export interface ModuleSnapshotItem {
	type: OrchestratorLayer;
	/** App: instanceName; resto: nombre lógico. */
	name: string;
	state: "running" | "disabled";
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
}

/** Opciones al deshabilitar. */
export interface DisableOptions {
	messageKey?: string;
	/** Quién dispara la acción (auditoría/logs). */
	actor?: string;
}

/** Objetivo de recarga desde disco tras git pull. */
export type ReloadTarget = { type: ModuleType; name: string } | { preset: string } | { core: true };
