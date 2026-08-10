/**
 * Registro de incidentes que afectan datos personales (art. 33.5 RGPD; Res. AAIP 47/2018).
 *
 * Vive en `@common` porque lo comparten el servicio que lo persiste
 * (`BreachRegisterService`) y el panel de administración que instruye el incidente.
 *
 * **No es el audit log**: ese guarda IDs y contadores y descarta cualquier cosa con pinta de
 * PII, que es exactamente lo contrario de lo que un registro de brechas necesita (naturaleza
 * del incidente, categorías de datos, motivos de una decisión). Por eso es colección propia y
 * **sin TTL**: es la prueba de que el criterio para notificar —o para no hacerlo— fue correcto.
 */

/**
 * Estados de la instrucción. El orden es el del procedimiento, no una preferencia:
 * `registered` es el punto en que el incidente existe formalmente aunque nunca se notifique.
 */
export type BreachState =
	| "detected"
	| "assessing"
	| "contained"
	| "registered"
	| "authority_notified"
	| "subjects_notified"
	| "no_notification"
	| "closed";

/** @public Transiciones admitidas. Cualquier otra es `INVALID_TRANSITION`. */
export const BREACH_TRANSITIONS: Readonly<Record<BreachState, readonly BreachState[]>> = {
	detected: ["assessing"],
	assessing: ["contained", "no_notification"],
	contained: ["registered"],
	registered: ["authority_notified", "no_notification"],
	authority_notified: ["subjects_notified", "closed"],
	subjects_notified: ["closed"],
	no_notification: ["closed"],
	closed: [],
};

/** @public De dónde salió el incidente. Alimenta la métrica de detección propia vs. externa. */
export type BreachSource = "internal" | "report" | "provider" | "authority";

/** Categorías de datos alcanzadas. Se declaran como lista para que la notificación las cite. */
export type BreachDataCategory = "identity" | "credentials" | "contact" | "mail" | "files" | "billing" | "usage" | "other";

/** Excepciones del art. 34.3 al aviso a las personas afectadas. */
export type BreachSubjectExemption = "encrypted" | "measures_taken" | "disproportionate_effort";

/** @public */
export type BreachRiskLevel = "low" | "medium" | "high";

/** @public Una acción de contención, con quién y cuándo: es la mitad de la prueba del art. 32. */
export interface BreachContainmentStep {
	at: Date;
	actorUserId: string;
	text: string;
}

/** @public Entrada del diario de la instrucción. Append-only: el valor probatorio está en no poder editarlo. */
export interface BreachEvent {
	at: Date;
	actorUserId: string;
	/** Estado al que se pasó, o `null` si fue una anotación sin cambio de estado. */
	to: BreachState | null;
	note: string;
}

/** @public */
export interface BreachRisk {
	severity: BreachRiskLevel;
	likelihood: BreachRiskLevel;
	/** Decide si el art. 34 (aviso a las personas) es obligatorio. Se fija al contener. */
	highRisk: boolean;
	rationale: string;
}

/** @public */
export interface BreachAuthorityNotice {
	required: boolean;
	notifiedAt: Date | null;
	/** `notifiedAt <= authorityDeadlineAt`. `null` mientras no se haya notificado. */
	onTime: boolean | null;
	/** Obligatorio si `onTime === false`: la propia política promete acompañar los motivos de la demora. */
	delayReason: string | null;
	acknowledgementRef: string | null;
	/** Texto exactamente como se envió: sin esto no hay prueba de qué se dijo. */
	bodySnapshot: string | null;
}

/** @public */
export interface BreachSubjectsNotice {
	required: boolean;
	exemption: BreachSubjectExemption | null;
	exemptionRationale: string | null;
	/** `broadcastId` del envío a segmento; hace idempotente cualquier reintento. */
	broadcastId: string | null;
	startedAt: Date | null;
	audienceSize: number;
	/** Entregas **confirmadas**. Nunca cuenta despachos encolados: eso todavía no llegó a nadie. */
	deliveredCount: number;
	/** Avisos entregados a la cola durable y aún sin confirmar (la cola reintenta y deduplica). */
	queuedCount: number;
	/** Comunicación pública (banner/status) cuando la excepción es el esfuerzo desproporcionado. */
	publicCommunicationUrl: string | null;
	bodySnapshot: string | null;
}

export interface BreachRecord {
	id: string;
	/** Referencia legible para citarla ante la autoridad (`BR-2026-001`). */
	ref: string;
	state: BreachState;
	openedBy: string;
	title: string;
	/** Constancia del conocimiento del hecho: es lo que arranca el reloj. */
	detectedAt: Date;
	/** `detectedAt + BREACH_AUTHORITY_DEADLINE_HOURS`, denormalizado para el barrido y la cuenta atrás. */
	authorityDeadlineAt: Date;
	source: BreachSource;
	sourceRef: string | null;
	/** art. 33.3.a — naturaleza del incidente. Texto libre: puede contener datos, por eso no va al audit log. */
	nature: string;
	dataCategories: BreachDataCategory[];
	approxSubjects: number | null;
	approxRecords: number | null;
	/** art. 33.3.c */
	likelyConsequences: string;
	containment: BreachContainmentStep[];
	/** art. 33.3.d / 33.5 */
	correctiveMeasures: string;
	risk: BreachRisk;
	authority: BreachAuthorityNotice;
	subjects: BreachSubjectsNotice;
	/** Obligatorio para cerrar sin notificar: es la decisión que una autoridad va a auditar. */
	decisionRationale: string | null;
	events: BreachEvent[];
	closedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Una persona afectada y el resultado real del aviso. La audiencia es evidencia: se congela antes
 * de enviar. `notifiedAt` sólo se sella con `sent`; `pending` y `failed` siguen siendo despachables
 * (un reintento los vuelve a tomar) y `queued` está en manos de la cola durable.
 */
export interface BreachAffected {
	breachId: string;
	userId: string;
	notifiedAt: Date | null;
	outcome: "pending" | "queued" | "sent" | "failed";
}

/** @public Resultados que todavía no salieron hacia nadie: son los que un reintento vuelve a tomar. */
export const BREACH_UNREACHED_OUTCOMES: readonly BreachAffected["outcome"][] = ["pending", "failed"];

/** Plazo del compromiso publicado en `/privacy` §11 (arts. 33-34 RGPD como compromiso propio). */
export const BREACH_AUTHORITY_DEADLINE_HOURS = 72;

/** @public Alta de un incidente: lo mínimo para que exista y el reloj empiece a correr. */
export interface BreachOpenInput {
	title: string;
	detectedAt: string;
	source: BreachSource;
	sourceRef?: string | null;
	nature?: string;
}

/** @public Campos que una transición puede traer. Cada estado exige los suyos (ver `BREACH_TRANSITIONS`). */
export interface BreachTransitionInput {
	to: BreachState;
	note?: string;
	nature?: string;
	dataCategories?: BreachDataCategory[];
	approxSubjects?: number | null;
	approxRecords?: number | null;
	likelyConsequences?: string;
	containmentStep?: string;
	correctiveMeasures?: string;
	risk?: Partial<BreachRisk>;
	authorityNotifiedAt?: string;
	authorityDelayReason?: string;
	authorityAcknowledgementRef?: string;
	authorityBody?: string;
	subjectsExemption?: BreachSubjectExemption;
	subjectsExemptionRationale?: string;
	subjectsPublicCommunicationUrl?: string;
	decisionRationale?: string;
}

/** @public Vista de lista: sin los textos largos, que sólo importan al abrir el incidente. */
export interface BreachSummary {
	id: string;
	ref: string;
	title: string;
	state: BreachState;
	detectedAt: string;
	authorityDeadlineAt: string;
	highRisk: boolean;
	approxSubjects: number | null;
	audienceSize: number;
	closedAt: string | null;
}
