/**
 * Contrato compartido de cuotas de almacenamiento (attachments) cross-app.
 *
 * El sujeto de la cuota es el par (usuario, contexto): el contexto personal y
 * cada organización llevan contadores SEPARADOS — subir en contexto org no
 * descuenta del uso personal ni viceversa. El uso agregado de una org es la
 * suma de los contadores de sus miembros en ese contexto.
 *
 * Cada app tiene un mínimo garantizado por contexto y tier (matriz central en
 * `@common/types/tiers/storage.ts`): aunque la cuota del contexto esté
 * agotada, la app puede seguir consumiendo hasta ese mínimo para no romper
 * funcionalidad básica (avatares, comentarios, etc.).
 *
 * Resolución de tiers: usuario → `user.metadata.accountTier` (default `free`);
 * org → `org.tier` (default `default`).
 */

/** Valor sentinela: sin límite (solo asignable en contexto global). */
export const UNLIMITED_BYTES = -1;

/** Identidad del consumidor de cuota. `orgId` viene del token, nunca del body. */
export interface QuotaSubject {
	userId: string;
	orgId?: string | null;
}

export interface QuotaCheckResult {
	allowed: boolean;
	reason?: "quota_exceeded";
	usedTotal: number;
	usedApp: number;
	/** Límite efectivo en bytes; `UNLIMITED_BYTES` = sin límite. */
	effectiveLimit: number;
}

/**
 * Interfaz que implementa StorageQuotaService y consumen los AttachmentsManager.
 * El mínimo garantizado por app lo resuelve el servicio desde la matriz central
 * (`@common/types/tiers/storage.ts`); el caller solo identifica su `appId`.
 */
export interface QuotaTracker {
	/** Chequeo informativo (no atómico) previo al presign. */
	checkAllowance(subject: QuotaSubject, appId: string, sizeBytes: number): Promise<QuotaCheckResult>;
	/**
	 * Incremento condicional atómico del uso con el tamaño real del objeto.
	 * Devuelve `false` si la cuota está agotada (el caller debe revertir la subida).
	 */
	commit(subject: QuotaSubject, appId: string, bytes: number): Promise<boolean>;
	/** Libera bytes comiteados (borrado de attachments `ready`) en el contexto del subject. */
	release(subject: QuotaSubject, appId: string, bytes: number): Promise<void>;
}

/** Getter lazy (espejo de `AuthVerifierGetter`): null si el servicio no está disponible. */
export type QuotaTrackerGetter = () => QuotaTracker | null;

export type QuotaSubjectType = "user" | "org" | "role" | "org-members-default";

/** Override de límite persistido (administración desde Identity). */
export interface StorageLimitOverride {
	id: string;
	subjectType: QuotaSubjectType;
	subjectId: string;
	/**
	 * null = override global (solo admin global); string = scoped a esa org.
	 * Para `org-members-default` siempre es `subjectId` (la org).
	 */
	orgId: string | null;
	/** Bytes; `UNLIMITED_BYTES` solo en contexto global. */
	limitBytes: number;
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
}

/** Uso por app dentro del documento de uso de un (usuario, contexto). */
export interface StorageAppUsage {
	bytes: number;
	count: number;
}

/** Snapshot de uso devuelto por los endpoints (`/api/storage/usage/me`). */
export interface StorageUsageSnapshot {
	userId: string;
	/** Contexto del snapshot: null = personal, string = organización. */
	orgId: string | null;
	totalBytes: number;
	totalCount: number;
	apps: Record<string, StorageAppUsage>;
	effectiveLimit: number;
	updatedAt?: string;
}

/** Entrada del registry de apps consumidoras (`/api/storage/apps`), con el mínimo resuelto para el contexto del caller. */
export interface StorageAppInfo {
	appId: string;
	label: string;
	minBytes: number;
}
