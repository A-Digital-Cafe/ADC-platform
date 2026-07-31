/**
 * Contrato compartido del motor de entitlements (`PlanService`).
 *
 * Espejo deliberado de `@common/types/storage/quota.ts`: un `EntitlementsProvider`
 * es a las features de plan lo que `QuotaTracker` es a los bytes. Los consumidores
 * lo obtienen con un getter lazy y **degradan a su matriz local** si el servicio no
 * está cargado (fail-open, igual que `AttachmentsManager`).
 *
 * El sujeto es el par (usuario, contexto), igual que en storage: el contexto personal
 * y cada organización se resuelven por separado, y `orgId` viene del token, nunca del body.
 */

import type { FeatureValue, MeterWindow, PlanAxis } from "./catalog.js";

export * from "./catalog.js";

/** Identidad del sujeto de un plan. `orgId` nulo = contexto personal. */
export interface PlanSubject {
	userId: string;
	orgId?: string | null;
}

/** Consumo de una feature por ventana. Ausente = sin consumo registrado. */
export interface UsageEntry {
	day?: number;
	month?: number;
	total?: number;
}

/** Motivos por los que una comprobación de feature puede denegar. */
export type PlanDenyReason =
	| "QUOTA_EXCEEDED"
	| "DAILY_QUOTA_EXCEEDED"
	| "TIER_LIMIT_REACHED"
	| "SEAT_LIMIT_REACHED"
	| "NOT_IN_PLAN";

export interface PlanCheckResult {
	allowed: boolean;
	/** Límite efectivo aplicado; `UNLIMITED` = sin tope. */
	limit: FeatureValue;
	/** Consumo actual en la ventana relevante. */
	used: number;
	/** Restante (`Infinity` si es ilimitado). */
	remaining: number;
	reason?: PlanDenyReason;
}

/** Snapshot completo de lo que un sujeto tiene derecho a usar. */
export interface EntitlementsDTO {
	subject: PlanSubject;
	axis: PlanAxis;
	/** `AccountTier` o `OrganizationTier` según el eje. */
	tier: string;
	/** Sólo en eje org: asientos pagos (driver del escalado) y ocupados. */
	paidSeats?: number;
	activeSeats?: number;
	/** Valores efectivos, ya resueltos por asientos y por overrides. */
	features: Record<string, FeatureValue>;
	usage: Record<string, UsageEntry>;
}

/**
 * Interfaz que implementa `PlanService` y consumen los módulos.
 *
 * `check` es informativo (no atómico); `commit` es la autoridad real y devuelve
 * `false` si la cuota se agotó entre medio — mismo contrato que `QuotaTracker.commit`.
 */
export interface EntitlementsProvider {
	/** Snapshot completo para la UI y para el endpoint `/api/plans/me`. */
	get(subject: PlanSubject): Promise<EntitlementsDTO>;
	/** Valor efectivo de una única feature (atajo sin construir el snapshot). */
	value(subject: PlanSubject, featureKey: string): Promise<FeatureValue | undefined>;
	/** Comprobación previa, sin consumir. */
	check(subject: PlanSubject, featureKey: string, amount?: number): Promise<PlanCheckResult>;
	/** Consumo atómico. `false` = no había cuota (el caller debe revertir). */
	commit(subject: PlanSubject, featureKey: string, amount?: number): Promise<boolean>;
	/** Devuelve consumo previamente comiteado (borrados, rollbacks). */
	release(subject: PlanSubject, featureKey: string, amount?: number): Promise<void>;
}

/** Getter lazy (espejo de `QuotaTrackerGetter`): null si el servicio no está disponible. */
export type EntitlementsGetter = () => EntitlementsProvider | null;

/** Sujetos a los que se les puede asignar una excepción de límite. */
export type PlanSubjectType = "user" | "org" | "role" | "org-members-default";

/**
 * Excepción de límite persistida. `orgId = null` ⇒ override global (sólo
 * administrable en contexto global); para `org-members-default`, `subjectId` es la
 * organización y el documento queda siempre scoped a ella.
 */
export interface PlanOverride {
	id: string;
	subjectType: PlanSubjectType;
	subjectId: string;
	orgId: string | null;
	featureKey: string;
	value: FeatureValue;
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
}

/** Contexto del actor que administra overrides. Sale del token, nunca del body. */
export interface PlanOverrideActor {
	userId: string;
	/** null/undefined = contexto global (admin global). */
	orgId?: string | null;
}

export interface UpsertPlanOverrideInput {
	subjectType: PlanSubjectType;
	subjectId: string;
	featureKey: string;
	value: FeatureValue;
}

/** Filtros y paginación de un listado de excepciones. */
export interface PlanOverridesQuery {
	featureKey?: string;
	/** Filtro puntual por sujeto: evita que el caller tenga que barrer la colección. */
	subjectType?: PlanSubjectType;
	subjectId?: string;
	limit?: number;
	offset?: number;
}

/**
 * Página de excepciones. `{ items, total }` y no un array: el listado está capado en el DAO, y sin
 * el `total` un consumidor no distingue la colección completa de su primera página.
 */
export interface PlanOverridePage {
	items: PlanOverride[];
	total: number;
}

/** Administración de excepciones, para los módulos que exponen su propio panel de límites. */
export interface PlanOverridesAdmin {
	list(actor: PlanOverrideActor, query?: PlanOverridesQuery): Promise<PlanOverridePage>;
	upsert(actor: PlanOverrideActor, input: UpsertPlanOverrideInput): Promise<PlanOverride>;
	remove(actor: PlanOverrideActor, overrideId: string): Promise<void>;
}

/** Lo que una organización tiene asignado como tal, sin mirar a ningún miembro. */
export interface OrgPlanSnapshot {
	orgId: string;
	tier: string;
	/** Valores del pool compartido, ya escalados por asientos y con overrides aplicados. */
	values: Record<string, FeatureValue>;
	paidSeats: number;
	/** `true` si la ampliación está otorgada. */
	expanded: boolean;
	/** Tope efectivo por miembro sin override propio, clampeado al pool. */
	memberDefaults: Record<string, FeatureValue>;
	/** El tope por miembro tal como lo define el plan, antes de `org-members-default`. */
	memberPlanDefaults: Record<string, FeatureValue>;
	/** El `org-members-default` administrado, si lo hay. */
	memberDefaultOverrides: Record<string, FeatureValue>;
}

/** Período de una ventana de medición, para el `_id` del contador. */
export function usagePeriod(window: MeterWindow, now: Date = new Date()): string {
	if (window === "total") return "all";
	const year = now.getUTCFullYear();
	const month = String(now.getUTCMonth() + 1).padStart(2, "0");
	if (window === "month") return `${year}-${month}`;
	return `${year}-${month}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Segundos hasta que la ventana rote y el contador se resetee (los períodos son
 * de calendario UTC, así que el reset es determinista). Sirve para el
 * `Retry-After` de un 429 por cuota: sin él el cliente reintenta a los 30s un
 * límite que puede durar semanas. `total` no rota: `null`.
 */
export function usagePeriodResetsInSeconds(window: MeterWindow, now: Date = new Date()): number | null {
	if (window === "total") return null;
	const next =
		window === "month"
			? Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
			: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
	return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}
