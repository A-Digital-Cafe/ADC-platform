import type { Model } from "mongoose";
import {
	BREACH_TRANSITIONS,
	BREACH_UNREACHED_OUTCOMES,
	type BreachAffected,
	type BreachOpenInput,
	type BreachRecord,
	type BreachState,
	type BreachSummary,
	type BreachTransitionInput,
} from "@common/types/security/Breach.ts";
import { BreachError } from "@common/types/custom-errors/BreachError.ts";
import { generateId } from "@common/utils/crypto.ts";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_TEXT = 5000;
/** Tope de los campos que son **prueba de lo que se envió**; coincide con el schema del endpoint. */
const MAX_SNAPSHOT_TEXT = 20000;

/** @public Tope de incidentes que devuelve {@link BreachRepository.dueForAuthority} por barrido. */
export const DUE_FOR_AUTHORITY_LIMIT = 50;

/** Cursor de paginación (orden `createdAt` desc, `id` desc): el último incidente visto. */
export interface BreachCursor {
	createdAt: Date;
	id: string;
}

function text(value: string | undefined, field: string, required = true, max = MAX_TEXT): string {
	const v = value?.trim();
	if (!v) {
		if (!required) return "";
		throw new BreachError(400, "MISSING_RATIONALE", `\`${field}\` es requerido para esta transición`);
	}
	return v.slice(0, max);
}

/**
 * Persistencia e **instrucción** del registro de incidentes. Los guards de la máquina de estados
 * viven acá y no en los endpoints: son reglas del procedimiento, no de la capa HTTP, y tienen que
 * regir igual si mañana el flujo se dispara desde otro lado.
 *
 * Nada se borra nunca: cada cambio agrega una entrada al diario del incidente.
 */
export class BreachRepository {
	readonly #model: Model<BreachRecord>;
	readonly #affected: Model<BreachAffected>;
	readonly #deadlineHours: number;

	constructor(model: Model<BreachRecord>, affected: Model<BreachAffected>, deadlineHours: number) {
		this.#model = model;
		this.#affected = affected;
		this.#deadlineHours = deadlineHours;
	}

	async open(actorUserId: string, input: BreachOpenInput): Promise<BreachRecord> {
		const detectedAt = new Date(input.detectedAt);
		if (Number.isNaN(detectedAt.getTime())) throw new BreachError(400, "INVALID_INPUT", "`detectedAt` no es una fecha válida");
		const title = text(input.title, "title");

		const doc: BreachRecord = {
			id: generateId(),
			ref: await this.#nextRef(detectedAt),
			state: "detected",
			openedBy: actorUserId,
			title,
			detectedAt,
			authorityDeadlineAt: new Date(detectedAt.getTime() + this.#deadlineHours * 60 * 60 * 1000),
			source: input.source,
			sourceRef: input.sourceRef?.trim() || null,
			nature: text(input.nature, "nature", false),
			dataCategories: [],
			approxSubjects: null,
			approxRecords: null,
			likelyConsequences: "",
			containment: [],
			correctiveMeasures: "",
			risk: { severity: "low", likelihood: "low", highRisk: false, rationale: "" },
			authority: { required: true, notifiedAt: null, onTime: null, delayReason: null, acknowledgementRef: null, bodySnapshot: null },
			subjects: {
				required: false,
				exemption: null,
				exemptionRationale: null,
				broadcastId: null,
				startedAt: null,
				audienceSize: 0,
				deliveredCount: 0,
				queuedCount: 0,
				publicCommunicationUrl: null,
				bodySnapshot: null,
			},
			decisionRationale: null,
			events: [{ at: new Date(), actorUserId, to: "detected", note: "Incidente abierto" }],
			closedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		await this.#model.create(doc);
		return doc;
	}

	async get(id: string): Promise<BreachRecord> {
		const doc = await this.#model.findOne({ id }).lean<BreachRecord>();
		if (!doc) throw new BreachError(404, "NOT_FOUND", "Incidente no encontrado");
		// Los incidentes anteriores al contador de encolados no traen el campo, y `lean` no aplica
		// los defaults del schema: sin esto la aritmética de los guards daría NaN.
		doc.subjects.queuedCount ??= 0;
		return doc;
	}

	/**
	 * Página de incidentes del más nuevo al más viejo. Cursor compuesto por (`createdAt`, `id`),
	 * el mismo par por el que se ordena: filtrar sólo por `id` —que es un UUID aleatorio— repetiría
	 * incidentes ya devueltos y escondería otros para siempre.
	 */
	async list(opts: {
		limit?: number;
		state?: BreachState;
		cursor?: BreachCursor;
	}): Promise<{ items: BreachSummary[]; nextCursor: BreachCursor | null }> {
		const limit = Math.min(Math.max(Math.floor(opts.limit || DEFAULT_LIMIT), 1), MAX_LIMIT);
		const filter: Record<string, unknown> = {};
		if (opts.state) filter.state = opts.state;
		if (opts.cursor) {
			filter.$or = [{ createdAt: { $lt: opts.cursor.createdAt } }, { createdAt: opts.cursor.createdAt, id: { $lt: opts.cursor.id } }];
		}
		const docs = await this.#model
			.find(filter)
			.sort({ createdAt: -1, id: -1 })
			.limit(limit + 1)
			.lean<BreachRecord[]>();
		const page = docs.slice(0, limit);
		const last = page.at(-1);
		return {
			items: page.map(summarize),
			nextCursor: docs.length > limit && last ? { createdAt: new Date(last.createdAt), id: last.id } : null,
		};
	}

	/**
	 * Aplica una transición si los datos que ese paso exige están completos. Cada guard existe
	 * porque sin ese campo el paso siguiente sería indefendible ante la autoridad, no por rigor
	 * formal: no se puede notificar tarde sin decir por qué, ni cerrar sin notificar sin fundamentar.
	 */
	async transition(id: string, actorUserId: string, input: BreachTransitionInput): Promise<BreachRecord> {
		const doc = await this.get(id);
		const allowed = BREACH_TRANSITIONS[doc.state] ?? [];
		if (!allowed.includes(input.to)) {
			throw new BreachError(409, "INVALID_TRANSITION", `No se puede pasar de '${doc.state}' a '${input.to}'`, {
				from: doc.state,
				allowed,
			});
		}

		const patch: Record<string, unknown> = { state: input.to, updatedAt: new Date() };
		const push: Record<string, unknown> = {};

		switch (input.to) {
			case "assessing":
				patch.nature = text(input.nature ?? doc.nature, "nature");
				break;

			case "contained": {
				patch.nature = text(input.nature ?? doc.nature, "nature");
				const cats = input.dataCategories ?? doc.dataCategories;
				if (!cats?.length) throw new BreachError(400, "MISSING_RATIONALE", "`dataCategories` no puede quedar vacío");
				patch.dataCategories = cats;
				patch.likelyConsequences = text(input.likelyConsequences ?? doc.likelyConsequences, "likelyConsequences");
				patch.approxSubjects = input.approxSubjects ?? doc.approxSubjects;
				patch.approxRecords = input.approxRecords ?? doc.approxRecords;
				const risk = { ...doc.risk, ...input.risk };
				risk.rationale = text(risk.rationale, "risk.rationale");
				patch.risk = risk;
				// El riesgo alto es lo que vuelve obligatorio el aviso del art. 34: se fija acá y de acá sale.
				patch["subjects.required"] = risk.highRisk;
				if (input.containmentStep) {
					push.containment = { at: new Date(), actorUserId, text: text(input.containmentStep, "containmentStep") };
				}
				break;
			}

			case "registered": {
				const steps = doc.containment.length + (input.containmentStep ? 1 : 0);
				if (steps === 0) throw new BreachError(400, "MISSING_RATIONALE", "Hace falta al menos una medida de contención registrada");
				patch.correctiveMeasures = text(input.correctiveMeasures ?? doc.correctiveMeasures, "correctiveMeasures");
				if (input.containmentStep) {
					push.containment = { at: new Date(), actorUserId, text: text(input.containmentStep, "containmentStep") };
				}
				break;
			}

			case "authority_notified": {
				const notifiedAt = new Date(input.authorityNotifiedAt ?? Date.now());
				if (Number.isNaN(notifiedAt.getTime())) throw new BreachError(400, "INVALID_INPUT", "`authorityNotifiedAt` inválido");
				const onTime = notifiedAt.getTime() <= new Date(doc.authorityDeadlineAt).getTime();
				patch["authority.notifiedAt"] = notifiedAt;
				patch["authority.onTime"] = onTime;
				patch["authority.acknowledgementRef"] = input.authorityAcknowledgementRef?.trim() || null;
				// Tope de prueba, no de campo de formulario: es el texto exacto que se le presentó a
				// la autoridad, y recortarlo en silencio sería falsear la constancia.
				patch["authority.bodySnapshot"] = text(input.authorityBody, "authorityBody", true, MAX_SNAPSHOT_TEXT);
				patch["authority.delayReason"] = onTime ? null : text(input.authorityDelayReason, "authorityDelayReason");
				break;
			}

			case "subjects_notified": {
				if (!doc.subjects.required) {
					throw new BreachError(409, "INVALID_TRANSITION", "El incidente no exige aviso a las personas afectadas");
				}
				if (input.subjectsExemption) {
					patch["subjects.exemption"] = input.subjectsExemption;
					patch["subjects.exemptionRationale"] = text(input.subjectsExemptionRationale, "subjectsExemptionRationale");
					if (input.subjectsExemption === "disproportionate_effort") {
						patch["subjects.publicCommunicationUrl"] = text(input.subjectsPublicCommunicationUrl, "subjectsPublicCommunicationUrl");
					}
				} else {
					if (doc.subjects.deliveredCount + doc.subjects.queuedCount === 0) {
						throw new BreachError(400, "AUDIENCE_EMPTY", "Sin avisos despachados y sin excepción del art. 34.3 invocada");
					}
					// El estado dice "se avisó a las personas": no puede quedar nadie a quien el aviso
					// no le salió. O se reintenta el despacho, o se invoca la excepción y se fundamenta.
					const unreached = await this.unreachedCount(id);
					if (unreached > 0) {
						throw new BreachError(409, "SUBJECTS_PENDING", `Quedan ${unreached} persona(s) sin aviso despachado`, { unreached });
					}
				}
				break;
			}

			case "no_notification":
				patch.decisionRationale = text(input.decisionRationale, "decisionRationale");
				patch["authority.required"] = false;
				patch["subjects.required"] = false;
				break;

			case "closed":
				patch.closedAt = new Date();
				break;

			default:
				break;
		}

		push.events = { at: new Date(), actorUserId, to: input.to, note: input.note?.trim().slice(0, MAX_TEXT) || "" };
		await this.#model.updateOne({ id }, { $set: patch, $push: push });
		return this.get(id);
	}

	/**
	 * Deshace una de las tres transiciones fail-closed cuando su rastro de auditoría no se pudo
	 * asentar. Repone exactamente los campos que esas transiciones tocan —`state`,
	 * `decisionRationale`, `authority` y `subjects`— y deja en el diario por qué se deshizo: el
	 * expediente sigue siendo append-only, lo que se revierte es el efecto, no la historia.
	 */
	async revertStrictTransition(id: string, previous: BreachRecord, actorUserId: string): Promise<void> {
		await this.#model.updateOne(
			{ id },
			{
				$set: {
					state: previous.state,
					decisionRationale: previous.decisionRationale,
					authority: previous.authority,
					subjects: previous.subjects,
					updatedAt: new Date(),
				},
				$push: {
					events: { at: new Date(), actorUserId, to: previous.state, note: "Transición deshecha: la auditoría no quedó asentada" },
				},
			}
		);
	}

	/** Anotación sin cambio de estado: el diario también sirve para lo que no mueve el expediente. */
	async annotate(id: string, actorUserId: string, note: string): Promise<BreachRecord> {
		await this.get(id);
		await this.#model.updateOne(
			{ id },
			{ $set: { updatedAt: new Date() }, $push: { events: { at: new Date(), actorUserId, to: null, note: text(note, "note") } } }
		);
		return this.get(id);
	}

	/** Congela la audiencia. Reemplaza la anterior: mientras no se envió, corregirla es legítimo. */
	async setAudience(id: string, userIds: string[]): Promise<number> {
		const doc = await this.get(id);
		if (doc.subjects.startedAt) throw new BreachError(409, "INVALID_TRANSITION", "El aviso ya salió: la audiencia no se puede reemplazar");
		const unique = [...new Set(userIds)].filter(Boolean);
		await this.#affected.deleteMany({ breachId: id });
		if (unique.length > 0) {
			await this.#affected.insertMany(
				unique.map((userId) => ({ breachId: id, userId, notifiedAt: null, outcome: "pending" as const })),
				{ ordered: false }
			);
		}
		await this.#model.updateOne({ id }, { $set: { "subjects.audienceSize": unique.length, updatedAt: new Date() } });
		return unique.length;
	}

	/** A quién todavía no le salió el aviso: primer intento pendiente o intento fallido. */
	async pendingAudience(id: string): Promise<string[]> {
		const rows = await this.#affected.find({ breachId: id, outcome: { $in: BREACH_UNREACHED_OUTCOMES } }).lean<BreachAffected[]>();
		return rows.map((r) => r.userId);
	}

	/** Cuántas personas de la audiencia siguen sin aviso despachado. */
	unreachedCount(id: string): Promise<number> {
		return this.#affected.countDocuments({ breachId: id, outcome: { $in: BREACH_UNREACHED_OUTCOMES } });
	}

	/**
	 * Asienta el resultado **de estas personas** en el libro de entregas. `notifiedAt` sólo se sella
	 * con `sent`: quien falló o quedó encolado no fue avisado todavía, y sellarlo lo volvería
	 * inalcanzable para siempre (`pendingAudience` dejaría de devolverlo y la audiencia ya no se
	 * puede reemplazar una vez que el aviso salió).
	 */
	async markOutcome(id: string, userIds: string[], outcome: BreachAffected["outcome"]): Promise<void> {
		if (userIds.length === 0) return;
		await this.#affected.updateMany(
			{ breachId: id, userId: { $in: userIds } },
			{ $set: { outcome, notifiedAt: outcome === "sent" ? new Date() : null } }
		);
	}

	/**
	 * Cierra el despacho: los contadores se **recalculan** desde el libro de entregas en vez de
	 * incrementarse, así un reintento no los infla. `startedAt` conserva la primera salida.
	 */
	async recordDispatch(id: string, broadcastId: string, bodySnapshot: string): Promise<void> {
		const [deliveredCount, queuedCount] = await Promise.all([
			this.#affected.countDocuments({ breachId: id, outcome: "sent" }),
			this.#affected.countDocuments({ breachId: id, outcome: "queued" }),
		]);
		await this.#model.updateOne({ id, "subjects.startedAt": null }, { $set: { "subjects.startedAt": new Date() } });
		await this.#model.updateOne(
			{ id },
			{
				$set: {
					"subjects.broadcastId": broadcastId,
					"subjects.bodySnapshot": bodySnapshot,
					"subjects.deliveredCount": deliveredCount,
					"subjects.queuedCount": queuedCount,
					updatedAt: new Date(),
				},
			}
		);
	}

	/** Incidentes cuyo plazo ante la autoridad está por vencer o ya venció, y todavía no se notificó. */
	async dueForAuthority(withinMs: number): Promise<BreachRecord[]> {
		return this.#model
			.find({
				state: { $in: ["detected", "assessing", "contained", "registered"] },
				"authority.required": true,
				authorityDeadlineAt: { $lte: new Date(Date.now() + withinMs) },
			})
			.sort({ authorityDeadlineAt: 1 })
			.limit(DUE_FOR_AUTHORITY_LIMIT)
			.lean<BreachRecord[]>();
	}

	/** `BR-<año>-<correlativo>`: legible para citarla en un expediente. */
	async #nextRef(detectedAt: Date): Promise<string> {
		const year = detectedAt.getUTCFullYear();
		const count = await this.#model.countDocuments({ ref: new RegExp(`^BR-${year}-`) });
		return `BR-${year}-${String(count + 1).padStart(3, "0")}`;
	}
}

export function summarize(doc: BreachRecord): BreachSummary {
	return {
		id: doc.id,
		ref: doc.ref,
		title: doc.title,
		state: doc.state,
		detectedAt: new Date(doc.detectedAt).toISOString(),
		authorityDeadlineAt: new Date(doc.authorityDeadlineAt).toISOString(),
		highRisk: doc.risk.highRisk,
		approxSubjects: doc.approxSubjects,
		audienceSize: doc.subjects.audienceSize,
		closedAt: doc.closedAt ? new Date(doc.closedAt).toISOString() : null,
	};
}
