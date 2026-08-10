import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import { BreachError } from "@common/types/custom-errors/BreachError.ts";
import { P } from "@common/types/Permissions.ts";
import type { BreachOpenInput, BreachState, BreachTransitionInput } from "@common/types/security/Breach.ts";
import type { BreachCursor } from "../dao/BreachRepository.ts";
import type BreachRegisterService from "../index.js";
import * as BS from "./schemas/breaches.ts";

const TAG = "BreachRegisterService/Breaches";

/** Cursor de wire `<createdAtISO>|<id>` → tupla tipada. Mismo formato que el audit log. */
function parseCursor(raw: string | undefined): BreachCursor | undefined {
	if (!raw) return undefined;
	const sep = raw.indexOf("|");
	if (sep <= 0) throw new BreachError(400, "INVALID_CURSOR", "`cursor` inválido");
	const createdAt = new Date(raw.slice(0, sep));
	const id = raw.slice(sep + 1);
	if (Number.isNaN(createdAt.getTime()) || !id) throw new BreachError(400, "INVALID_CURSOR", "`cursor` inválido");
	return { createdAt, id };
}

/**
 * Registro de incidentes de datos personales. Recurso `security` (global-only) con su propio
 * bit `breach`: además del permiso se exige contexto global, porque un admin de organización
 * no instruye incidentes de la plataforma.
 */
export class BreachEndpoints {
	static #service: BreachRegisterService;

	static init(service: BreachRegisterService): void {
		BreachEndpoints.#service ??= service;
	}

	/** Contexto global + sesión. Devuelve el actor para no repetir el chequeo en cada handler. */
	static #actor(ctx: EndpointCtx): string {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay sesión");
		if (ctx.user.orgId) throw new AuthError(403, "FORBIDDEN", "El registro de incidentes se instruye en contexto global");
		return ctx.user.id;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/security/breaches",
		permissions: [P.SECURITY.BREACH.READ],
		options: {
			tag: TAG,
			summary: "Lista de incidentes de datos personales, paginada por cursor",
			description: "Registro del art. 33.5 RGPD. Filtro opcional por estado; cursor `<createdAtISO>|<id>`, del más nuevo al más viejo.",
			rateLimit: { max: 60, timeWindow: 60_000 },
			schema: { querystring: BS.BreachListQuery, response: { 200: BS.BreachListResponse } },
		},
	})
	static async list(ctx: EndpointCtx) {
		BreachEndpoints.#actor(ctx);
		const limit = Number.parseInt(ctx.query.limit ?? "", 10);
		const { items, nextCursor } = await BreachEndpoints.#service.list({
			limit: Number.isFinite(limit) ? limit : undefined,
			cursor: parseCursor(ctx.query.cursor || undefined),
			state: (ctx.query.state as BreachState) || undefined,
		});
		return { items, nextCursor: nextCursor ? `${nextCursor.createdAt.toISOString()}|${nextCursor.id}` : null };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/security/breaches",
		permissions: [P.SECURITY.BREACH.WRITE],
		options: {
			tag: TAG,
			summary: "Abre un incidente y arranca el plazo de notificación a la autoridad",
			description: "`detectedAt` es la constancia del conocimiento del hecho: de ahí salen las 72 h.",
			skipIdempotency: true,
			schema: { body: BS.BreachOpenBody },
		},
	})
	static async open(ctx: EndpointCtx<Record<string, string>, BreachOpenInput>) {
		const actorUserId = BreachEndpoints.#actor(ctx);
		return BreachEndpoints.#service.open(actorUserId, ctx.data);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/security/breaches/:id",
		permissions: [P.SECURITY.BREACH.READ],
		options: { tag: TAG, summary: "Incidente completo con su diario de instrucción" },
	})
	static async detail(ctx: EndpointCtx<{ id: string }>) {
		BreachEndpoints.#actor(ctx);
		return BreachEndpoints.#service.get(ctx.params.id);
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/security/breaches/:id/transition",
		permissions: [P.SECURITY.BREACH.EXECUTE],
		options: {
			tag: TAG,
			summary: "Avanza el incidente al estado siguiente",
			description:
				"Una sola ruta para toda la máquina de estados. Cada transición exige los campos sin los cuales el paso " +
				"siguiente sería indefendible: notificar tarde exige el motivo de la demora, y cerrar sin notificar exige " +
				"el fundamento de esa decisión. Notificar a la autoridad, dar por avisadas a las personas y decidir no " +
				"notificar son fail-closed: sin auditoría disponible devuelven 503 y no se aplican.",
			skipIdempotency: true,
			schema: { body: BS.BreachTransitionBody },
		},
	})
	static async transition(ctx: EndpointCtx<{ id: string }, BreachTransitionInput>) {
		const actorUserId = BreachEndpoints.#actor(ctx);
		return BreachEndpoints.#service.transition(ctx.params.id, actorUserId, ctx.data);
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/security/breaches/:id/note",
		permissions: [P.SECURITY.BREACH.WRITE],
		options: { tag: TAG, summary: "Anota en el diario sin mover el estado", skipIdempotency: true, schema: { body: BS.BreachAnnotateBody } },
	})
	static async annotate(ctx: EndpointCtx<{ id: string }, { note: string }>) {
		const actorUserId = BreachEndpoints.#actor(ctx);
		return BreachEndpoints.#service.annotate(ctx.params.id, actorUserId, ctx.data.note);
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/security/breaches/:id/audience",
		permissions: [P.SECURITY.BREACH.EXECUTE],
		options: {
			tag: TAG,
			summary: "Congela la audiencia del aviso a personas afectadas",
			description:
				"Se persiste antes de enviar: a quién se avisó es evidencia, no un efecto del envío. No se puede reemplazar una vez enviada.",
			skipIdempotency: true,
			schema: { body: BS.BreachAudienceBody, response: { 200: BS.BreachAudienceResponse } },
		},
	})
	static async audience(ctx: EndpointCtx<{ id: string }, { userIds: string[] }>) {
		BreachEndpoints.#actor(ctx);
		return { audienceSize: await BreachEndpoints.#service.setAudience(ctx.params.id, ctx.data.userIds) };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/security/breaches/:id/notify-subjects",
		permissions: [P.SECURITY.BREACH.EXECUTE],
		options: {
			tag: TAG,
			summary: "Avisa a las personas afectadas por el canal insilenciable de incidentes",
			description:
				"Sólo despacha a quien sigue pendiente; el `broadcastId` del incidente hace idempotente el reintento. Asienta el " +
				"resultado por persona: `pending` son las entregas que fallaron y siguen siendo reintentables.",
			skipIdempotency: true,
			schema: { body: BS.BreachNotifyBody, response: { 200: BS.BreachNotifyResponse } },
		},
	})
	static async notifySubjects(ctx: EndpointCtx<{ id: string }, { body?: string }>) {
		BreachEndpoints.#actor(ctx);
		return BreachEndpoints.#service.notifySubjects(ctx.params.id, ctx.data?.body);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/security/breaches/:id/templates",
		permissions: [P.SECURITY.BREACH.READ],
		options: {
			tag: TAG,
			summary: "Borradores de notificación derivados del registro",
			description: "Notificación a la autoridad (estructura del art. 33.3), aviso a las personas y comunicación pública.",
			schema: { response: { 200: BS.BreachTemplatesResponse } },
		},
	})
	static async templates(ctx: EndpointCtx<{ id: string }>) {
		BreachEndpoints.#actor(ctx);
		return BreachEndpoints.#service.templates(ctx.params.id);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/security/breaches/:id/export",
		permissions: [P.SECURITY.BREACH.READ],
		options: { tag: TAG, summary: "Paquete del incidente (registro + cronología) para acompañar a la autoridad" },
	})
	static async exportPackage(ctx: EndpointCtx<{ id: string }>) {
		BreachEndpoints.#actor(ctx);
		return BreachEndpoints.#service.exportPackage(ctx.params.id);
	}
}
