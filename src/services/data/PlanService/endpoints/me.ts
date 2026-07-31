import { RegisterEndpoint, type EndpointCtx } from "@services/core/EndpointManagerService/index.js";
import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import type { EntitlementsDTO } from "@common/types/plans/index.ts";
import type PlanService from "../index.js";
import * as S from "./schemas/index.js";

/**
 * Entitlements del caller. Fuente única para el gating de la UI: devuelve el tier,
 * los valores efectivos de cada feature (ya resueltos por asientos y overrides) y
 * el consumo actual.
 *
 * El contexto sale SIEMPRE del token (`ctx.user.orgId`), nunca de la query.
 */
export class MeEndpoints {
	private static service: PlanService;
	private static kernelKey: symbol;

	static init(service: PlanService, kernelKey: symbol): void {
		MeEndpoints.service ??= service;
		MeEndpoints.kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/plans/me",
		deferAuth: true,
		options: {
			tag: "PlanService/Me",
			summary: "Entitlements del usuario (tier, features efectivas y consumo)",
			schema: { response: { 200: S.EntitlementsResponse } },
		},
	})
	static async me(ctx: EndpointCtx): Promise<EntitlementsDTO> {
		const userId = ctx.user?.id;
		if (!userId) throw new PlanError(401, "NOT_AUTHENTICATED", "Sesión requerida");
		return MeEndpoints.service.manager.get({ userId, orgId: ctx.user?.orgId ?? null });
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/plans/orgs/:orgId/seats",
		deferAuth: true,
		options: {
			tag: "PlanService/Me",
			summary: "Asientos pagos y ocupados de una organización",
			description: "Sólo la organización del token: el contexto no se puede pedir por parámetro.",
			schema: { params: S.OrgIdParams, response: { 200: S.SeatsResponse } },
		},
	})
	static async seats(ctx: EndpointCtx<{ orgId: string }>) {
		const userId = ctx.user?.id;
		if (!userId) throw new PlanError(401, "NOT_AUTHENTICATED", "Sesión requerida");
		const callerOrgId = ctx.user?.orgId ?? null;
		if (callerOrgId !== ctx.params.orgId) {
			throw new PlanError(403, "ORG_ACCESS_DENIED", "No tienes acceso a esta organización");
		}
		const seats = await MeEndpoints.service.seats(ctx.params.orgId);
		return { orgId: ctx.params.orgId, ...seats };
	}
}
