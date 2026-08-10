export const SECURITY_RESOURCE_NAME = "security" as const;

// Scope (bitfield)

/**
 * Scopes del recurso `security` (bitfield). Recurso **global-only**: sus permisos
 * sólo son efectivos desde roles globales (ver `globalOnly` en resources.ts).
 *
 * - SESSIONS: listar/revocar sesiones de usuarios (SessionManagerService admin).
 * - AUDIT: lectura del audit log administrativo (ModulesManagerService).
 * - AUDIT_LOG: lectura del registro persistente de acciones administrativas sobre
 *   datos personales (AuditLogService; accountability art. 5.2 RGPD / art. 9 Ley 25.326).
 */
export const SecurityScopes = {
	NONE: 0,
	SESSIONS: 1, // 1
	AUDIT: 1 << 1, // 2
	AUDIT_LOG: 1 << 2, // 4
	ALL: 1 | (1 << 1) | (1 << 2), // 7
} as const;

export type SecurityScopeValue = (typeof SecurityScopes)[keyof typeof SecurityScopes];
