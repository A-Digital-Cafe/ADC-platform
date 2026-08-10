import { Type } from "@sinclair/typebox";

/** Schemas TypeBox del registro de incidentes de datos personales. */

const StateEnum = Type.Union([
	Type.Literal("detected"),
	Type.Literal("assessing"),
	Type.Literal("contained"),
	Type.Literal("registered"),
	Type.Literal("authority_notified"),
	Type.Literal("subjects_notified"),
	Type.Literal("no_notification"),
	Type.Literal("closed"),
]);

const DataCategory = Type.Union([
	Type.Literal("identity"),
	Type.Literal("credentials"),
	Type.Literal("contact"),
	Type.Literal("mail"),
	Type.Literal("files"),
	Type.Literal("billing"),
	Type.Literal("usage"),
	Type.Literal("other"),
]);

const RiskLevel = Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]);

export const BreachListQuery = Type.Object({
	limit: Type.Optional(Type.String({ pattern: String.raw`^\d+$`, description: "Tamaño de página (máx. 100, por defecto 25)" })),
	cursor: Type.Optional(Type.String({ description: "`nextCursor` de la página anterior" })),
	state: Type.Optional(StateEnum),
});

const BreachSummarySchema = Type.Object({
	id: Type.String(),
	ref: Type.String(),
	title: Type.String(),
	state: StateEnum,
	detectedAt: Type.String({ format: "date-time" }),
	authorityDeadlineAt: Type.String({ format: "date-time" }),
	highRisk: Type.Boolean(),
	approxSubjects: Type.Union([Type.Number(), Type.Null()]),
	audienceSize: Type.Number(),
	closedAt: Type.Union([Type.String(), Type.Null()]),
});

export const BreachListResponse = Type.Object({
	items: Type.Array(BreachSummarySchema),
	nextCursor: Type.Union([Type.String(), Type.Null()]),
});

export const BreachOpenBody = Type.Object({
	title: Type.String({ minLength: 5, maxLength: 200 }),
	detectedAt: Type.String({ format: "date-time", description: "Cuándo se tomó conocimiento: arranca el plazo de 72 h" }),
	source: Type.Union([Type.Literal("internal"), Type.Literal("report"), Type.Literal("provider"), Type.Literal("authority")]),
	sourceRef: Type.Optional(Type.String({ maxLength: 200 })),
	nature: Type.Optional(Type.String({ maxLength: 5000 })),
});

export const BreachTransitionBody = Type.Object({
	to: StateEnum,
	note: Type.Optional(Type.String({ maxLength: 5000 })),
	nature: Type.Optional(Type.String({ maxLength: 5000 })),
	dataCategories: Type.Optional(Type.Array(DataCategory)),
	approxSubjects: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	approxRecords: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	likelyConsequences: Type.Optional(Type.String({ maxLength: 5000 })),
	containmentStep: Type.Optional(Type.String({ maxLength: 5000 })),
	correctiveMeasures: Type.Optional(Type.String({ maxLength: 5000 })),
	risk: Type.Optional(
		Type.Object({
			severity: Type.Optional(RiskLevel),
			likelihood: Type.Optional(RiskLevel),
			highRisk: Type.Optional(Type.Boolean()),
			rationale: Type.Optional(Type.String({ maxLength: 5000 })),
		})
	),
	authorityNotifiedAt: Type.Optional(Type.String({ format: "date-time" })),
	authorityDelayReason: Type.Optional(Type.String({ maxLength: 5000 })),
	authorityAcknowledgementRef: Type.Optional(Type.String({ maxLength: 200 })),
	authorityBody: Type.Optional(Type.String({ maxLength: 20000 })),
	subjectsExemption: Type.Optional(
		Type.Union([Type.Literal("encrypted"), Type.Literal("measures_taken"), Type.Literal("disproportionate_effort")])
	),
	subjectsExemptionRationale: Type.Optional(Type.String({ maxLength: 5000 })),
	subjectsPublicCommunicationUrl: Type.Optional(Type.String({ maxLength: 500 })),
	decisionRationale: Type.Optional(Type.String({ maxLength: 5000 })),
});

export const BreachAnnotateBody = Type.Object({ note: Type.String({ minLength: 1, maxLength: 5000 }) });

export const BreachAudienceBody = Type.Object({
	userIds: Type.Array(Type.String({ maxLength: 100 }), { maxItems: 50000, description: "Audiencia completa; reemplaza la anterior" }),
});

export const BreachNotifyBody = Type.Object({
	body: Type.Optional(Type.String({ maxLength: 20000, description: "Texto final del aviso; si falta se usa el borrador" })),
});

export const BreachNotifyResponse = Type.Object({
	recipients: Type.Number({ description: "Entregas confirmadas asentadas en el libro" }),
	queued: Type.Number({ description: "Avisos en la cola durable, todavía sin confirmar" }),
	pending: Type.Number({ description: "Personas de la audiencia sin aviso despachado (reintentables)" }),
});

export const BreachAudienceResponse = Type.Object({ audienceSize: Type.Number() });

export const BreachTemplatesResponse = Type.Object({
	authority: Type.String(),
	subjects: Type.Object({ title: Type.String(), body: Type.String() }),
	publicCommunication: Type.String(),
});
