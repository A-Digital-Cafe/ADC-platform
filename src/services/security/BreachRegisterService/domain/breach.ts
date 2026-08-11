import { Schema } from "mongoose";
import type { BreachAffected, BreachRecord } from "@common/types/security/Breach.ts";

const containmentSchema = new Schema(
	{
		at: { type: Date, required: true },
		actorUserId: { type: String, required: true },
		text: { type: String, required: true },
	},
	{ _id: false }
);

const eventSchema = new Schema(
	{
		at: { type: Date, required: true },
		actorUserId: { type: String, required: true },
		to: { type: String, default: null },
		note: { type: String, default: "" },
	},
	{ _id: false }
);

const riskSchema = new Schema(
	{
		severity: { type: String, default: "low" },
		likelihood: { type: String, default: "low" },
		highRisk: { type: Boolean, default: false },
		rationale: { type: String, default: "" },
	},
	{ _id: false }
);

const authoritySchema = new Schema(
	{
		required: { type: Boolean, default: true },
		notifiedAt: { type: Date, default: null },
		onTime: { type: Boolean, default: null },
		delayReason: { type: String, default: null },
		acknowledgementRef: { type: String, default: null },
		bodySnapshot: { type: String, default: null },
	},
	{ _id: false }
);

const subjectsSchema = new Schema(
	{
		required: { type: Boolean, default: false },
		exemption: { type: String, default: null },
		exemptionRationale: { type: String, default: null },
		broadcastId: { type: String, default: null },
		startedAt: { type: Date, default: null },
		audienceSize: { type: Number, default: 0 },
		deliveredCount: { type: Number, default: 0 },
		queuedCount: { type: Number, default: 0 },
		publicCommunicationUrl: { type: String, default: null },
		bodySnapshot: { type: String, default: null },
	},
	{ _id: false }
);

/**
 * Colección `breach_incidents`. El TTL cuelga de `closedAt`, no de `createdAt`: Mongo ignora los
 * documentos cuyo campo indexado no es una fecha, así que **un incidente abierto no caduca nunca**
 * y el reloj de los 5 años sólo arranca cuando se cierra. Ver `BREACH_DEFAULT_RETENTION_DAYS`.
 */
export function buildBreachSchema(retentionSeconds: number): Schema<BreachRecord> {
	const schema = new Schema<BreachRecord>(
		{
			id: { type: String, required: true, unique: true },
			ref: { type: String, required: true, unique: true },
			state: { type: String, required: true },
			openedBy: { type: String, required: true },
			title: { type: String, required: true },
			detectedAt: { type: Date, required: true },
			authorityDeadlineAt: { type: Date, required: true },
			source: { type: String, required: true },
			sourceRef: { type: String, default: null },
			nature: { type: String, default: "" },
			dataCategories: { type: [String], default: [] },
			approxSubjects: { type: Number, default: null },
			approxRecords: { type: Number, default: null },
			likelyConsequences: { type: String, default: "" },
			containment: { type: [containmentSchema], default: [] },
			correctiveMeasures: { type: String, default: "" },
			risk: { type: riskSchema, default: () => ({}) },
			authority: { type: authoritySchema, default: () => ({}) },
			subjects: { type: subjectsSchema, default: () => ({}) },
			decisionRationale: { type: String, default: null },
			events: { type: [eventSchema], default: [] },
			closedAt: { type: Date, default: null },
			createdAt: { type: Date, default: () => new Date() },
			updatedAt: { type: Date, default: () => new Date() },
		},
		{ id: false, versionKey: false, autoIndex: false, collection: "breach_incidents" }
	);

	schema.index({ createdAt: -1, id: -1 });
	// Barrido del reloj de 72 h: incidentes abiertos ordenados por vencimiento.
	schema.index({ state: 1, authorityDeadlineAt: 1 });
	// Retención del art. 33.5: Mongo borra el incidente pasado el plazo desde su cierre.
	schema.index({ closedAt: 1 }, { expireAfterSeconds: retentionSeconds });

	return schema;
}

/**
 * Colección `breach_affected`: audiencia **y** libro de entregas a la vez. Se congela antes de
 * enviar porque a quién se avisó es parte de la prueba, no un efecto del envío.
 */
export function buildBreachAffectedSchema(retentionSeconds: number): Schema<BreachAffected> {
	const schema = new Schema<BreachAffected>(
		{
			breachId: { type: String, required: true },
			userId: { type: String, required: true },
			notifiedAt: { type: Date, default: null },
			outcome: { type: String, default: "pending" },
			closedAt: { type: Date, default: null },
		},
		{ id: false, versionKey: false, autoIndex: false, collection: "breach_affected" }
	);

	schema.index({ breachId: 1, userId: 1 }, { unique: true });
	// Por `outcome` y no por `notifiedAt`: lo que se busca es a quién le falta el aviso, y eso
	// incluye a los que fallaron (sin `notifiedAt`, pero tampoco pendientes de primer intento).
	schema.index({ breachId: 1, outcome: 1 });
	// Mismo plazo y mismo disparador que el incidente: la audiencia y su libro de entregas son
	// parte de la misma prueba, así que se van juntos.
	schema.index({ closedAt: 1 }, { expireAfterSeconds: retentionSeconds });

	return schema;
}
