// ─────────────────────────────────────────────────────────────────────────────
// Resource
// ─────────────────────────────────────────────────────────────────────────────

export const MODULES_RESOURCE_NAME = "modules" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Scope (bitfield)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scopes del recurso `modules` (gestión de módulos de plataforma, bitfield).
 * Recurso **global-only**: sus permisos sólo son efectivos desde roles globales
 * (ver `globalOnly` en resources.ts) — la gestión de módulos es de plataforma,
 * nunca de una organización.
 *
 * - RUNTIME: ver estado y start/stop/restart/rebuild de módulos.
 * - GIT: git pull de presets/core con recarga desde disco.
 * - BANNERS: avisos de la status page + anuncios broadcast (EXECUTE).
 * - SCHEDULE: programar mantenimientos/updates.
 * - AUDIT: audit log completo del modules-manager.
 */
export const ModulesScopes = {
	NONE: 0,
	RUNTIME: 1, // 1
	GIT: 1 << 1, // 2
	BANNERS: 1 << 2, // 4
	SCHEDULE: 1 << 3, // 8
	AUDIT: 1 << 4, // 16
	ALL: 1 | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4), // 31
} as const;

export type ModulesScopeValue = (typeof ModulesScopes)[keyof typeof ModulesScopes];
