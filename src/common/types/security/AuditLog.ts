import type { CapabilityToken } from "../../security/Capability.ts";

/**
 * Registro persistente de acciones administrativas sobre datos personales (accountability art. 5.2
 * RGPD / art. 9 Ley 25.326). Append-only: las entradas sólo expiran por TTL. El log NO debe
 * volverse él mismo un repositorio de PII — de ahí que `context` acepte sólo primitivos.
 */

/** Retención por defecto de cada entrada (2 años). Configurable vía `AUDIT_LOG_RETENTION_DAYS`. */
export const AUDIT_LOG_DEFAULT_RETENTION_DAYS = 730;

/** Valores admitidos en `context`: primitivos planos, sin objetos anidados. */
export type AuditContextValue = string | number | boolean | null;

/** Entrada tal como la aporta el módulo productor (el resto lo completa el servicio). */
export interface AuditEntryInput {
	/** Acción con namespace del dominio, ej. `"drive.recover-deleted"`. */
	action: string;
	/** Usuario que ejecutó la acción administrativa. */
	actorUserId: string;
	/** Roles del actor al momento de la acción (si el productor los conoce). */
	actorRoles?: string[];
	/** Usuario cuyos datos fueron afectados. */
	targetUserId?: string;
	/** Recurso afectado (identificador lógico, ej. `"drive:legal-hold"` o un ID). */
	targetResource?: string;
	/** Contexto acotado: solo IDs/contadores/flags. Se sanea al escribir. */
	context?: Record<string, AuditContextValue>;
}

/** Entrada persistida: input + metadatos que estampa el servicio. */
export interface AuditLogRecord extends AuditEntryInput {
	id: string;
	at: Date;
	/** Módulo productor. Sale del `owner` de la capability, no del caller: no es falsificable. */
	origin: string;
}

/** Cursor de paginación (orden `at` desc, `id` desc): la última entrada vista. */
export interface AuditLogCursor {
	at: Date;
	id: string;
}

/** Filtros de consulta del endpoint admin. */
export interface AuditLogQuery {
	limit?: number;
	cursor?: AuditLogCursor;
	action?: string;
	actorUserId?: string;
	targetUserId?: string;
}

export interface AuditLogPage {
	items: AuditLogRecord[];
	nextCursor: AuditLogCursor | null;
}

/**
 * Superficie de escritura para módulos productores. Ambas variantes exigen scope `audit:write`.
 *
 * - `record`: best-effort — nunca lanza; un fallo queda en un warn del servicio.
 * - `recordStrict`: fail-closed — lanza `AuditError` si la entrada no quedó persistida. Para
 *   operaciones de alto riesgo cuyo rastro es condición de la operación.
 * - `isWritable`: pre-flight barato para abortar ANTES de mutar en flujos fail-closed.
 */
export interface IAuditLogService {
	isWritable(): boolean;
	record(token: CapabilityToken, entry: AuditEntryInput): Promise<void>;
	recordStrict(token: CapabilityToken, entry: AuditEntryInput): Promise<void>;
}
