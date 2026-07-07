// ─────────────────────────────────────────────────────────────────────────────
// Resource
// ─────────────────────────────────────────────────────────────────────────────

export const SECURITY_RESOURCE_NAME = "security" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Scope (bitfield)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scopes del recurso `security` (bitfield). Recurso **global-only**: sus permisos
 * sólo son efectivos desde roles globales (ver `globalOnly` en resources.ts).
 *
 * - SESSIONS: listar/revocar sesiones de usuarios (SessionManagerService admin).
 * - AUDIT: lectura del audit log administrativo (ModulesManagerService).
 */
export const SecurityScopes = {
	NONE: 0,
	SESSIONS: 1, // 1
	AUDIT: 1 << 1, // 2
	ALL: 1 | (1 << 1), // 3
} as const;

export type SecurityScopeValue = (typeof SecurityScopes)[keyof typeof SecurityScopes];
