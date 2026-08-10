import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import { AuditError } from "@common/types/custom-errors/AuditError.ts";
import { P } from "@common/types/Permissions.ts";
import type { AuditLogCursor } from "@common/types/security/AuditLog.ts";
import type AuditLogService from "../index.js";
import * as AS from "./schemas/audit.ts";

/** Cursor de wire `<atISO>|<id>` → tupla tipada. Mismo formato que el audit del gestor de módulos. */
function parseCursor(raw: string | undefined): AuditLogCursor | undefined {
	if (!raw) return undefined;
	const sep = raw.indexOf("|");
	if (sep <= 0) throw new AuditError(400, "INVALID_CURSOR", "`cursor` inválido");
	const at = new Date(raw.slice(0, sep));
	const id = raw.slice(sep + 1);
	if (Number.isNaN(at.getTime()) || !id) throw new AuditError(400, "INVALID_CURSOR", "`cursor` inválido");
	return { at, id };
}

function cleanFilter(v: string | undefined): string | undefined {
	const t = v?.trim();
	return t || undefined;
}

/** Endpoint de consulta del audit log — solo admin global (recurso `security`, global-only). */
export class AuditEndpoints {
	static #service: AuditLogService;

	static init(service: AuditLogService): void {
		AuditEndpoints.#service ??= service;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/security/audit-log",
		permissions: [P.SECURITY.AUDIT_LOG.READ],
		options: {
			tag: "AuditLogService/Audit",
			summary: "Audit log persistente de acciones administrativas sobre datos personales, paginado por cursor",
			description:
				"Registro append-only (accountability art. 5.2 RGPD / art. 9 Ley 25.326): actor, acción, usuario afectado, " +
				"recurso y contexto acotado a IDs (nunca emails, IPs completas ni contenido). Filtros exactos por " +
				"`action`/`actorUserId`/`targetUserId`; cursor `<atISO>|<id>`.",
			rateLimit: { max: 60, timeWindow: 60_000 },
			schema: { querystring: AS.AuditListQuery, response: { 200: AS.AuditListResponse } },
		},
	})
	static async list(ctx: EndpointCtx) {
		// Recurso global-only: además del permiso, se exige contexto global (patrón BanEndpoints/LogManager).
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay sesión");
		if (ctx.user.orgId) throw new AuthError(403, "FORBIDDEN", "El audit log se consulta en contexto global");
		const limit = Number.parseInt(ctx.query.limit ?? "", 10);
		const { items, nextCursor } = await AuditEndpoints.#service.listAudit({
			limit: Number.isFinite(limit) ? limit : undefined,
			cursor: parseCursor(ctx.query.cursor),
			action: cleanFilter(ctx.query.action),
			actorUserId: cleanFilter(ctx.query.actorUserId),
			targetUserId: cleanFilter(ctx.query.targetUserId),
		});
		return {
			items: items.map((e) => ({
				id: e.id,
				at: new Date(e.at).toISOString(),
				origin: e.origin,
				action: e.action,
				actorUserId: e.actorUserId,
				actorRoles: e.actorRoles,
				targetUserId: e.targetUserId,
				targetResource: e.targetResource,
				context: e.context,
			})),
			nextCursor: nextCursor ? `${new Date(nextCursor.at).toISOString()}|${nextCursor.id}` : null,
		};
	}
}
