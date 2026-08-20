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
 * - BREACH: registro e instrucción de incidentes que afectan datos personales
 *   (BreachRegisterService; art. 33.5 RGPD, Res. AAIP 47/2018). Bit propio y no derivado
 *   de AUDIT_LOG: el registro lleva descripciones del incidente que el audit log rechaza,
 *   y decidir *no* notificar es una potestad distinta de leer el rastro.
 * - LEGAL: ciclo de vida de los documentos legales (LegalDocsService): ver qué versión rige,
 *   generar los PDF congelados, re-anunciar un cambio y leer las cifras de aceptación. Bit
 *   propio porque quien administra los documentos que la gente acepta no es necesariamente
 *   quien instruye incidentes ni quien lee el rastro de acciones sobre datos personales.
 */
export const SecurityScopes = {
	NONE: 0,
	SESSIONS: 1, // 1
	AUDIT: 1 << 1, // 2
	AUDIT_LOG: 1 << 2, // 4
	BREACH: 1 << 3, // 8
	LEGAL: 1 << 4, // 16
	ALL: 1 | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4), // 31
} as const;

/** @public */
export type SecurityScopeValue = (typeof SecurityScopes)[keyof typeof SecurityScopes];
