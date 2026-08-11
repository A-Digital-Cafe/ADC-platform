import type { Model } from "mongoose";
import { BaseService } from "../../BaseService.js";
import type MongoProvider from "../../../providers/object/mongo/index.js";
import type { Kernel } from "../../../kernel.js";
import type { IAuditLogService } from "@common/types/security/AuditLog.ts";
import type { IIdleOrchestrator, IdleRunContext } from "@common/types/operations/IIdleOrchestrator.ts";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.ts";
import {
	BREACH_AUTHORITY_DEADLINE_HOURS,
	BREACH_DEFAULT_RETENTION_DAYS,
	type BreachAffected,
	type BreachOpenInput,
	type BreachRecord,
	type BreachState,
	type BreachSummary,
	type BreachTransitionInput,
} from "@common/types/security/Breach.ts";
import { PLATFORM_TOPICS } from "@common/utils/notifications/platform-topics.ts";
import { BreachError } from "@common/types/custom-errors/BreachError.ts";
import { publicEnv } from "@common/utils/public-env.ts";
import { SystemRole } from "@services/core/IdentityManagerService/defaults/systemRoles.js";
import { buildBreachAffectedSchema, buildBreachSchema } from "./domain/breach.ts";
import { buildAuthorityNotice, buildPublicCommunication, buildSubjectsNotice } from "./domain/templates.ts";
import { BreachRepository, DUE_FOR_AUTHORITY_LIMIT, summarize, type BreachCursor } from "./dao/BreachRepository.ts";
import { EnableEndpoints, DisableEndpoints } from "../../core/EndpointManagerService/index.js";
import { BreachEndpoints } from "./endpoints/breaches.ts";

interface BreachPrivateConfig {
	authorityDeadlineHours?: number | string;
	reminderLeadHours?: number | string;
	retentionDays?: number | string;
}

/** Etapa del reloj por la que ya se alertó. Cada incidente pasa por las dos, una sola vez. */
type DeadlineStage = "due" | "expired";

/**
 * Topic de las alertas internas del registro. **No** es `security.*` a propósito: los topics
 * reservados los renderiza el servidor desde una plantilla canónica y descartan el texto del
 * productor, así que la referencia del incidente y el plazo —lo único que vuelve accionable el
 * aviso— no llegarían nunca al equipo.
 */
const BREACH_ALERT_TOPIC = "breach.alert" as const;

/**
 * Registro e instrucción de incidentes que afectan datos personales (art. 33.5 RGPD;
 * Res. AAIP 47/2018), que es lo que `/privacy` §11 promete y hasta ahora no existía.
 *
 * Tres cosas que no son un CRUD y por las que el servicio existe:
 *  - el reloj de 72 h se calcula al abrir y un trabajo de fondo avisa antes de que venza;
 *  - decidir **no** notificar exige fundamentarlo y queda asentado igual que notificar;
 *  - el aviso a las personas afectadas sale por `notifySegment`, con la audiencia congelada
 *    de antemano y el resultado real de cada entrega asentado.
 */
export default class BreachRegisterService extends BaseService {
	public readonly name = "BreachRegisterService";

	readonly #mongoProvider: MongoProvider;
	#repo: BreachRepository | null = null;
	/** Alertas del reloj ya emitidas, por incidente y por etapa. Ver `#watchDeadlines`. */
	readonly #alertedDeadlines = new Map<string, Set<DeadlineStage>>();

	constructor(kernel: Kernel, options?: ConstructorParameters<typeof BaseService>[1]) {
		super(kernel, options);
		this.#mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
	}

	@EnableEndpoints({ managers: () => [BreachEndpoints] })
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		await this.#waitConnected();

		const retentionSeconds = this.#retentionSeconds();
		const incidents = this.#mongoProvider.createModel<BreachRecord>("breach_incidents", buildBreachSchema(retentionSeconds));
		const affected = this.#mongoProvider.createModel<BreachAffected>("breach_affected", buildBreachAffectedSchema(retentionSeconds));
		await this.#syncIndexes(incidents);
		await this.#syncIndexes(affected);
		this.#repo = new BreachRepository(incidents, affected, this.#deadlineHours());

		this.#registerDeadlineWatch();
		BreachEndpoints.init(this);
		this.logger.logOk(`${this.name} iniciado`);
	}

	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		// Antes del super.stop(): después ya no está garantizado resolver la dependencia.
		this.tryGetMyService<IIdleOrchestrator>("OperationsService")?.unregisterIdleJobs(this.getCapability());
		await super.stop(kernelKey);
		this.#repo = null;
	}

	// ─── API que consumen los endpoints ───────────────────────────────────────

	async open(actorUserId: string, input: BreachOpenInput): Promise<BreachRecord> {
		const doc = await this.#requireRepo().open(actorUserId, input);
		// Best-effort a propósito: abrir un incidente no puede quedar bloqueado porque la
		// auditoría esté caída. Lo que sí es fail-closed son las decisiones (ver #audit).
		void this.#auditWriter()?.record(this.getCapability(), {
			action: "breach.opened",
			actorUserId,
			targetResource: "security:breach",
			context: { ref: doc.ref, source: doc.source },
		});
		void this.#alertTeam(
			{
				breach: doc,
				title: `Incidente de datos abierto: ${doc.ref}`,
				body: `${doc.title}. Plazo ante la autoridad: ${doc.authorityDeadlineAt.toISOString()}.`,
			},
			actorUserId
		);
		return doc;
	}

	list(opts: {
		limit?: number;
		state?: BreachState;
		cursor?: BreachCursor;
	}): Promise<{ items: BreachSummary[]; nextCursor: BreachCursor | null }> {
		return this.#requireRepo().list(opts);
	}

	get(id: string): Promise<BreachRecord> {
		return this.#requireRepo().get(id);
	}

	/**
	 * Aplica una transición. Las tres decisiones que una autoridad va a revisar —notificar a la
	 * autoridad, avisar a las personas y decidir **no** notificar— son fail-closed respecto de la
	 * auditoría, con el patrón del resto del repo: pre-flight ANTES de mutar y compensación si aun
	 * así el rastro no queda. Sin `AuditLogService` cargado tampoco hay rastro posible, así que
	 * ese caso bloquea igual que una auditoría caída.
	 */
	async transition(id: string, actorUserId: string, input: BreachTransitionInput): Promise<BreachRecord> {
		const repo = this.#requireRepo();
		const strict = input.to === "no_notification" || input.to === "authority_notified" || input.to === "subjects_notified";
		const audit = this.#auditWriter();
		if (strict && !audit?.isWritable()) {
			throw new BreachError(503, "AUDIT_UNAVAILABLE", "Auditoría no disponible: la decisión no se aplica sin dejar rastro");
		}

		const previous = strict ? await repo.get(id) : null;
		const doc = await repo.transition(id, actorUserId, input);
		const entry = {
			action: `breach.${input.to.replace(/_/g, "-")}`,
			actorUserId,
			targetResource: "security:breach",
			context: {
				ref: doc.ref,
				state: doc.state,
				highRisk: doc.risk.highRisk,
				onTime: doc.authority.onTime,
				audienceSize: doc.subjects.audienceSize,
				delivered: doc.subjects.deliveredCount,
				queued: doc.subjects.queuedCount,
				exemption: doc.subjects.exemption,
			},
		};
		if (!strict || !previous) {
			void audit?.record(this.getCapability(), entry);
			return doc;
		}
		try {
			await audit!.recordStrict(this.getCapability(), entry);
		} catch (auditError) {
			// La decisión no puede quedar aplicada sin rastro: se repone el estado previo y el
			// operador reintenta. Si la compensación también falla, manda el error original.
			await repo.revertStrictTransition(id, previous, actorUserId).catch(() => {});
			throw auditError;
		}
		return doc;
	}

	annotate(id: string, actorUserId: string, note: string): Promise<BreachRecord> {
		return this.#requireRepo().annotate(id, actorUserId, note);
	}

	setAudience(id: string, userIds: string[]): Promise<number> {
		return this.#requireRepo().setAudience(id, userIds);
	}

	/**
	 * Avisa a las personas afectadas por el canal insilenciable `platform.security_incident`.
	 *
	 * Idempotente por diseño: sólo despacha a quien todavía figura sin avisar, y el
	 * `broadcastId` derivado del incidente hace que un reintento no duplique nada.
	 *
	 * Lo que se asienta es el resultado **real de cada entrega**, no el intento: sólo quien recibió
	 * queda `sent`, y a quien le falló sigue estando en la audiencia pendiente para el reintento.
	 * Con cola durable nadie recibió nada todavía (el fan-out lo hace el consumidor), así que ese
	 * despacho se asienta como `queued` y no como entregado.
	 */
	async notifySubjects(id: string, body?: string): Promise<{ recipients: number; queued: number; pending: number }> {
		const repo = this.#requireRepo();
		const doc = await repo.get(id);
		const pending = await repo.pendingAudience(id);
		if (pending.length === 0) throw new BreachError(400, "AUDIENCE_EMPTY", "No queda nadie pendiente de aviso en la audiencia");

		const draft = buildSubjectsNotice(doc, this.#contactEmail());
		const finalBody = body?.trim() || draft.body;
		const broadcastId = `breach:${doc.id}`;
		const { mode, recipients, failedUserIds } = await this.emitSegment({
			broadcastId,
			topic: PLATFORM_TOPICS.securityIncident.topic,
			title: draft.title,
			body: finalBody,
			linkApp: "help",
			link: "/privacy#incidentes",
			data: { breachRef: doc.ref },
			userIds: pending,
		});
		if (mode === "dropped") {
			throw new BreachError(
				503,
				"NOTIFICATIONS_UNAVAILABLE",
				"El subsistema de notificaciones no está disponible: el aviso no se despachó"
			);
		}

		if (mode === "queued") {
			await repo.markOutcome(id, pending, "queued");
		} else {
			const failed = this.#failedRecipients(pending, recipients, failedUserIds);
			await repo.markOutcome(
				id,
				pending.filter((userId) => !failed.has(userId)),
				"sent"
			);
			await repo.markOutcome(id, [...failed], "failed");
		}
		await repo.recordDispatch(id, broadcastId, finalBody);

		const after = await repo.get(id);
		return {
			recipients: after.subjects.deliveredCount,
			queued: after.subjects.queuedCount,
			pending: await repo.unreachedCount(id),
		};
	}

	/** Borradores derivados del registro (la autoridad, las personas y la comunicación pública). */
	async templates(id: string): Promise<{ authority: string; subjects: { title: string; body: string }; publicCommunication: string }> {
		const doc = await this.#requireRepo().get(id);
		const contact = this.#contactEmail();
		return {
			authority: buildAuthorityNotice(doc, publicEnv("operatorLegalName") || "el responsable del tratamiento", contact),
			subjects: buildSubjectsNotice(doc, contact),
			publicCommunication: buildPublicCommunication(doc, contact),
		};
	}

	/** Paquete completo del incidente, que es lo que se acompaña a la autoridad. */
	async exportPackage(id: string): Promise<Record<string, unknown>> {
		const doc = await this.#requireRepo().get(id);
		return {
			...summarize(doc),
			source: doc.source,
			sourceRef: doc.sourceRef,
			nature: doc.nature,
			dataCategories: doc.dataCategories,
			approxRecords: doc.approxRecords,
			likelyConsequences: doc.likelyConsequences,
			containment: doc.containment,
			correctiveMeasures: doc.correctiveMeasures,
			risk: doc.risk,
			authority: doc.authority,
			// La audiencia es una lista de ids: el paquete lleva el recuento, no las personas.
			subjects: { ...doc.subjects },
			decisionRationale: doc.decisionRationale,
			timeline: doc.events,
		};
	}

	// ─── Privados ─────────────────────────────────────────────────────────────

	/**
	 * Quiénes NO recibieron el aviso en un despacho directo.
	 *
	 * Si el servicio de notificaciones no informa los ids (implementación vieja) y el recuento no
	 * cierra, no hay forma de saber a quién le llegó: se asienta a toda la tanda como fallida en
	 * vez de repartir la duda. El reintento converge sin duplicar —la dedup por `broadcastId` hace
	 * que quien ya recibió el aviso cuente como entrega buena— y mientras tanto nadie figura
	 * avisado sin estarlo.
	 */
	#failedRecipients(dispatched: string[], recipients: number, failedUserIds?: string[]): Set<string> {
		if (failedUserIds) {
			const audience = new Set(dispatched);
			return new Set(failedUserIds.filter((userId) => audience.has(userId)));
		}
		if (recipients >= dispatched.length) return new Set();
		this.logger.logWarn(
			`[BreachRegisterService] el despacho no informó qué entregas fallaron (${recipients}/${dispatched.length}): la tanda queda pendiente de reintento`
		);
		return new Set(dispatched);
	}

	/**
	 * Reloj de las 72 h. No es un recordatorio de cortesía: la política promete notificar dentro
	 * del plazo y, si no, explicar la demora — sin este aviso el plazo se vence en silencio.
	 */
	#registerDeadlineWatch(): void {
		const idle = this.tryGetMyService<IIdleOrchestrator>("OperationsService");
		if (!idle) {
			this.logger.logWarn("Vigilancia del plazo de 72 h no disponible: OperationsService no está cargado");
			return;
		}
		const leadMs = this.#reminderLeadHours() * 60 * 60 * 1000;
		idle.registerIdleJob(this.getCapability(), {
			id: "breach-deadline-watch",
			description: "Avisa al equipo de los incidentes con el plazo de notificación a la autoridad por vencer",
			intervalMs: 5 * 60 * 1000,
			batchBudgetMs: 2000,
			run: (ctx) => this.#watchDeadlines(ctx, leadMs),
		});
	}

	/**
	 * Un aviso por incidente **y por etapa**: el que anticipa el vencimiento y el que avisa que ya
	 * venció son dos hechos distintos y el segundo es el que obliga a acompañar los motivos de la
	 * demora. Con una sola marca compartida, un incidente solo nunca llegaba a la segunda etapa y
	 * dos incidentes a la vez se pisaban la marca y repetían el aviso cada 5 minutos.
	 */
	async #watchDeadlines(ctx: IdleRunContext, leadMs: number): Promise<number> {
		const repo = this.#repo;
		if (!repo) return 0;
		const due = await repo.dueForAuthority(leadMs);
		let processed = 0;
		for (const doc of due) {
			if (ctx.signal.aborted) break;
			const deadline = new Date(doc.authorityDeadlineAt);
			const stage: DeadlineStage = deadline.getTime() < Date.now() ? "expired" : "due";
			const stages = this.#alertedDeadlines.get(doc.ref) ?? new Set<DeadlineStage>();
			if (stages.has(stage)) continue;
			stages.add(stage);
			this.#alertedDeadlines.set(doc.ref, stages);
			await this.#alertTeam({
				breach: doc,
				title: stage === "expired" ? `Plazo VENCIDO: incidente ${doc.ref}` : `Plazo por vencer: incidente ${doc.ref}`,
				body:
					stage === "expired"
						? `El plazo de notificación a la autoridad venció el ${deadline.toISOString()}. La notificación tiene que ir acompañada de los motivos de la demora.`
						: `Quedan menos de ${Math.round(leadMs / 3_600_000)} h para notificar a la autoridad (vence ${deadline.toISOString()}).`,
				data: { stage },
			});
			processed++;
		}
		// Un incidente que ya salió del barrido (notificado o cerrado) libera su marca. Sólo se poda
		// cuando la página no vino truncada: si vino llena, lo ausente puede ser sólo lo que no entró.
		if (due.length < DUE_FOR_AUTHORITY_LIMIT) {
			const active = new Set(due.map((d) => d.ref));
			for (const ref of this.#alertedDeadlines.keys()) if (!active.has(ref)) this.#alertedDeadlines.delete(ref);
		}
		return processed;
	}

	/**
	 * Alerta al equipo que instruye incidentes (Admins y Security Managers globales) por
	 * {@link BREACH_ALERT_TOPIC}, con la referencia, el plazo y el enlace al panel: sin eso el
	 * aviso no dice de qué incidente habla. Best-effort: nunca lanza.
	 */
	async #alertTeam(
		alert: { breach: BreachRecord; title: string; body: string; data?: Record<string, unknown> },
		excludeUserId?: string
	): Promise<void> {
		try {
			const targets = await this.#securityTeam();
			await Promise.allSettled(
				targets
					.filter((userId) => userId !== excludeUserId)
					.map((userId) =>
						this.emitNotification({
							userId,
							topic: BREACH_ALERT_TOPIC,
							title: alert.title,
							body: alert.body,
							linkApp: "admin",
							link: "/",
							data: {
								breachId: alert.breach.id,
								ref: alert.breach.ref,
								authorityDeadlineAt: new Date(alert.breach.authorityDeadlineAt).toISOString(),
								...alert.data,
							},
						})
					)
			);
		} catch (err: any) {
			this.logger.logWarn(`[BreachRegisterService] alerta al equipo no enviada: ${err?.message || err}`);
		}
	}

	/**
	 * Destinatarios de las alertas: portadores de roles **globales** de administración o seguridad.
	 * `getAllRoles()` sin organización devuelve sólo los de `orgId: null`, así que un rol de
	 * organización con el mismo nombre no recibe el detalle de un incidente de plataforma.
	 */
	async #securityTeam(): Promise<string[]> {
		const identity = this.tryGetMyService<IIdentityManagerService>("IdentityManagerService");
		if (!identity) return [];
		const internal = identity._internal(this.getCapability());
		const { items } = await internal.roles.getAllRoles();
		const roleIds = items.filter((r) => r.name === SystemRole.ADMIN || r.name === SystemRole.SECURITY_MANAGER).map((r) => r.id);
		const lists = await Promise.all(roleIds.map((roleId) => internal.users.getUsersByRole(roleId)));
		return [...new Set(lists.flat())];
	}

	#auditWriter(): IAuditLogService | null {
		return this.tryGetMyService<IAuditLogService>("AuditLogService") ?? null;
	}

	#contactEmail(): string {
		return publicEnv("contactEmail") || "";
	}

	#requireRepo(): BreachRepository {
		if (!this.#repo) throw new BreachError(503, "BREACH_UNAVAILABLE", "BreachRegisterService no inicializado");
		return this.#repo;
	}

	#private(): BreachPrivateConfig {
		return (this.config?.private as BreachPrivateConfig | undefined) ?? {};
	}

	#deadlineHours(): number {
		const h = Number(this.#private().authorityDeadlineHours);
		return Number.isFinite(h) && h > 0 ? h : BREACH_AUTHORITY_DEADLINE_HOURS;
	}

	#reminderLeadHours(): number {
		const h = Number(this.#private().reminderLeadHours);
		return Number.isFinite(h) && h > 0 ? h : 12;
	}

	/** Retención del registro del art. 33.5, contada desde el cierre. Ver `BREACH_DEFAULT_RETENTION_DAYS`. */
	#retentionSeconds(): number {
		const days = Number(this.#private().retentionDays);
		return (Number.isFinite(days) && days > 0 ? days : BREACH_DEFAULT_RETENTION_DAYS) * 24 * 60 * 60;
	}

	async #syncIndexes(model: Model<any>): Promise<void> {
		try {
			await model.syncIndexes();
		} catch (err: any) {
			this.logger.logWarn(`[BreachRegisterService] syncIndexes de ${model.collection.name} falló: ${err?.message || err}`);
		}
	}

	async #waitConnected(): Promise<void> {
		const t0 = Date.now();
		while (!this.#mongoProvider.isConnected() && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 250));
		if (!this.#mongoProvider.isConnected()) throw new Error("[BreachRegisterService] Mongo no se conectó en el tiempo esperado");
	}
}
