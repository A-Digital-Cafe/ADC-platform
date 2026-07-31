import { RegisterEndpoint, type EndpointCtx } from "@services/core/EndpointManagerService/index.js";
import { P } from "@common/types/Permissions.ts";
import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import type { UpsertPlanOverrideInput } from "@common/types/plans/index.ts";
import type { PlanSubjectType } from "../domain/index.ts";
import type PlanService from "../index.js";
import { adminActor, paging, toOverrideDto } from "./utils/actor.ts";
import * as S from "./schemas/index.js";

/**
 * Excepciones de límite por sujeto.
 *
 * El actor sale SIEMPRE del token: un admin de organización queda forzado a su org
 * y el DAO valida la jerarquía (sujeto de su org, clamp ≤ valor de la org, sin `-1`).
 */
export class AdminOverridesEndpoints {
	private static service: PlanService;
	private static kernelKey: symbol;

	static init(service: PlanService, kernelKey: symbol): void {
		AdminOverridesEndpoints.service ??= service;
		AdminOverridesEndpoints.kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/plans/admin/overrides",
		permissions: [P.PLANS.OVERRIDES.READ],
		options: {
			tag: "PlanService/Admin",
			summary: "Lista excepciones de límite (paginada)",
			description:
				"En contexto organización, el filtro se fuerza a los overrides de esa organización. " +
				"El listado está capado en el DAO: `total` es el conteo real del filtro, no el de la página.",
			schema: { querystring: S.OverridesQuery, response: { 200: S.OverridesListResponse } },
		},
	})
	static async listOverrides(ctx: EndpointCtx) {
		const query = ctx.query ?? {};
		const page = await AdminOverridesEndpoints.service.daos.overrides.list(adminActor(ctx), {
			featureKey: query.featureKey,
			subjectType: query.subjectType as PlanSubjectType | undefined,
			subjectId: query.subjectId,
			...paging(ctx),
		});
		return { overrides: page.items.map(toOverrideDto), total: page.total };
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/plans/admin/overrides",
		permissions: [P.PLANS.OVERRIDES.UPDATE],
		options: {
			tag: "PlanService/Admin",
			summary: "Crea o actualiza una excepción de límite",
			skipIdempotency: true,
			description:
				"Admin global: cualquier sujeto (user/org/role/org-members-default), `-1` permitido. " +
				"Admin de organización: sólo user/role de su organización o el `org-members-default` propio, sin `-1`. " +
				"Comprar asientos es un override de `org.seats` sobre el sujeto `org`.",
			rateLimit: { max: 30, timeWindow: 60_000 },
			schema: { body: S.UpsertOverrideBody, response: { 200: S.OverrideDto } },
		},
	})
	static async upsertOverride(ctx: EndpointCtx<Record<string, string>, UpsertPlanOverrideInput>) {
		if (!ctx.data?.subjectId || !ctx.data?.subjectType || !ctx.data?.featureKey || ctx.data?.value === undefined) {
			throw new PlanError(400, "MISSING_FIELDS", "`subjectType`, `subjectId`, `featureKey` y `value` requeridos");
		}
		const service = AdminOverridesEndpoints.service;
		const override = await service.daos.overrides.upsert(adminActor(ctx), {
			subjectType: ctx.data.subjectType,
			subjectId: ctx.data.subjectId.trim(),
			featureKey: ctx.data.featureKey.trim(),
			value: ctx.data.value,
		});
		service.invalidate();
		return toOverrideDto(override);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/plans/admin/overrides/:id",
		permissions: [P.PLANS.OVERRIDES.UPDATE],
		options: {
			tag: "PlanService/Admin",
			summary: "Elimina una excepción de límite",
			skipIdempotency: true,
			rateLimit: { max: 30, timeWindow: 60_000 },
			schema: { params: S.OverrideIdParams, response: { 200: S.OkResponse } },
		},
	})
	static async removeOverride(ctx: EndpointCtx<{ id: string }>) {
		const service = AdminOverridesEndpoints.service;
		await service.daos.overrides.remove(adminActor(ctx), ctx.params.id);
		service.invalidate();
		return { ok: true };
	}
}
