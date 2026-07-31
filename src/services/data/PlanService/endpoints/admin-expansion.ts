import { RegisterEndpoint, type EndpointCtx } from "@services/core/EndpointManagerService/index.js";
import { P } from "@common/types/Permissions.ts";
import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import type PlanService from "../index.js";
import { adminActor, assertGlobalActor } from "./utils/actor.ts";
import * as S from "./schemas/index.js";

/** La ampliación es una decisión de la plataforma: una org no se la otorga a sí misma. */
const EXPANSION_SCOPE = "Las ampliaciones";

/** Ampliación de los pools compartidos de una organización (`org.expansion`). */
export class AdminExpansionEndpoints {
	private static service: PlanService;
	private static kernelKey: symbol;

	static init(service: PlanService, kernelKey: symbol): void {
		AdminExpansionEndpoints.service ??= service;
		AdminExpansionEndpoints.kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/plans/admin/orgs/:orgId/expansion",
		permissions: [P.PLANS.OVERRIDES.READ],
		options: {
			tag: "PlanService/Admin",
			summary: "Estado de la ampliación de una organización",
			schema: { params: S.OrgIdParams, response: { 200: S.ExpansionResponse } },
		},
	})
	static async getExpansion(ctx: EndpointCtx<{ orgId: string }>) {
		assertGlobalActor(ctx, EXPANSION_SCOPE);
		const service = AdminExpansionEndpoints.service;
		const snapshot = await service.manager.orgSnapshot(ctx.params.orgId);
		const plan = await service.daos.catalog.getPlan("org", snapshot.tier);
		return {
			orgId: snapshot.orgId,
			tier: snapshot.tier,
			granted: snapshot.expanded,
			paidSeats: snapshot.paidSeats,
			available: plan?.expansionFeatures !== undefined,
		};
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/plans/admin/orgs/:orgId/expansion",
		permissions: [P.PLANS.OVERRIDES.UPDATE],
		options: {
			tag: "PlanService/Admin",
			summary: "Otorga o revoca la ampliación de una organización",
			skipIdempotency: true,
			description:
				"Es la contraparte del ticket de tipo `AMPLIACIÓN`: se otorga a criterio de la plataforma según la justificación " +
				"recibida y se revoca si el uso perjudica al resto. No cambia el precio, no agrega asientos y revocarla no toca " +
				"la suscripción: sólo devuelve los límites del plan contratado.",
			rateLimit: { max: 30, timeWindow: 60_000 },
			schema: { params: S.OrgIdParams, body: S.SetExpansionBody, response: { 200: S.OkResponse } },
		},
	})
	static async setExpansion(ctx: EndpointCtx<{ orgId: string }, { granted: boolean }>) {
		const { userId } = adminActor(ctx);
		assertGlobalActor(ctx, EXPANSION_SCOPE);
		if (typeof ctx.data?.granted !== "boolean") {
			throw new PlanError(400, "MISSING_FIELDS", "`granted` requerido");
		}
		const service = AdminExpansionEndpoints.service;
		if (ctx.data.granted) {
			// Sin `expansionFeatures` el override se guardaría y no haría nada: mejor decirlo.
			const tier = (await service.manager.orgSnapshot(ctx.params.orgId)).tier;
			const plan = await service.daos.catalog.getPlan("org", tier);
			if (!plan?.expansionFeatures) {
				throw new PlanError(400, "INVALID_FIELD", `El plan "${tier}" no define una ampliación`, { tier });
			}
		}
		await service.daos.orgAdmin.setExpansion(ctx.params.orgId, ctx.data.granted, userId);
		return { ok: true };
	}
}
