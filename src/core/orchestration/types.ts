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
	dependents: { apps: string[]; services: string[] };
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
