import { RegisterEndpoint, type EndpointCtx } from "@services/core/EndpointManagerService/index.js";
import { P } from "@common/types/Permissions.ts";
import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import type { PlanAxis } from "@common/types/plans/index.ts";
import type { ImportPlanItem, UpdatePlanPatch } from "../domain/index.ts";
import type PlanService from "../index.js";
import { assertGlobalActor } from "./utils/actor.ts";
import * as S from "./schemas/index.js";

/** El catálogo es un recurso `globalOnly`: editarlo sólo es posible desde un rol global. */
const CATALOG_SCOPE = "Los planes";

/**
 * Administración de la **oferta**: el catálogo de planes.
 *
 * Las excepciones por sujeto viven en `admin-overrides.ts` y la ampliación de una
 * organización en `admin-expansion.ts`.
 */
export class AdminCatalogEndpoints {
	private static service: PlanService;
	private static kernelKey: symbol;

	static init(service: PlanService, kernelKey: symbol): void {
		AdminCatalogEndpoints.service ??= service;
		AdminCatalogEndpoints.kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/plans/admin/plans",
		permissions: [P.PLANS.CATALOG.READ],
		options: {
			tag: "PlanService/Admin",
			summary: "Planes completos, con features no vendibles incluidas",
			schema: { response: { 200: S.CatalogResponse } },
		},
	})
	static async listPlans(_ctx: EndpointCtx) {
		const catalog = AdminCatalogEndpoints.service.daos.catalog;
		return { features: catalog.listFeatures(), plans: await catalog.listPlans() };
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/plans/admin/plans",
		permissions: [P.PLANS.CATALOG.UPDATE],
		options: {
			tag: "PlanService/Admin",
			summary: "Importa la oferta comercial (bulk, merge por plan)",
			description:
				"Publica la oferta comercial sobre `plan_definitions`. Es la vía por la que una herramienta externa " +
				"de administración de precios carga los planes reales; los valores del código son defaults de desarrollo. " +
				"Merge por clave sobre cada plan y `seeded: false`: el plan importado queda congelado frente a los defaults del código. " +
				"Valida que todos los planes existan antes de escribir el primero.",
			rateLimit: { max: 10, timeWindow: 60_000 },
			schema: { body: S.ImportPlansBody, response: { 200: S.ImportPlansResponse } },
		},
	})
	static async importPlans(ctx: EndpointCtx<Record<string, string>, { plans: ImportPlanItem[] }>) {
		assertGlobalActor(ctx, CATALOG_SCOPE);
		if (!ctx.data?.plans?.length) throw new PlanError(400, "MISSING_FIELDS", "`plans` requerido");
		const updated = await AdminCatalogEndpoints.service.daos.writer.importPlans(ctx.data.plans);
		return { ok: true, updated };
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/plans/admin/plans/:axis/:tier",
		permissions: [P.PLANS.CATALOG.UPDATE],
		options: {
			tag: "PlanService/Admin",
			summary: "Edita un plan (merge parcial de features)",
			skipIdempotency: true,
			description:
				"Marca el plan como editado: los siguientes arranques ya no lo re-siembran desde los defaults del código. " +
				"En el eje org, un valor puede ser `{ base, perSeat }` para escalar con los asientos pagos.",
			rateLimit: { max: 30, timeWindow: 60_000 },
			schema: { params: S.PlanParams, body: S.UpdatePlanBody, response: { 200: S.OkResponse } },
		},
	})
	static async updatePlan(ctx: EndpointCtx<{ axis: PlanAxis; tier: string }, UpdatePlanPatch>) {
		assertGlobalActor(ctx, CATALOG_SCOPE);
		await AdminCatalogEndpoints.service.daos.writer.updatePlan(ctx.params.axis, ctx.params.tier, {
			price: ctx.data?.price,
			includedSeats: ctx.data?.includedSeats,
			features: ctx.data?.features,
			memberFeatures: ctx.data?.memberFeatures,
		});
		return { ok: true };
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/plans/admin/plans/:axis/:tier/customization",
		permissions: [P.PLANS.CATALOG.UPDATE],
		options: {
			tag: "PlanService/Admin",
			summary: "Devuelve un plan a los valores del código",
			skipIdempotency: true,
			description:
				"Descarta la personalización y vuelve a sembrar el plan desde los defaults del código (plataforma + módulos registrados). " +
				"También descarta la oferta importada: tras un reset hay que volver a publicarla con el bulk de `PUT /api/plans/admin/plans`. " +
				"Es la contraparte de que el seed no pise planes editados: sin esto, un plan tocado una vez queda congelado.",
			rateLimit: { max: 30, timeWindow: 60_000 },
			schema: { params: S.PlanParams, response: { 200: S.OkResponse } },
		},
	})
	static async resetPlan(ctx: EndpointCtx<{ axis: PlanAxis; tier: string }>) {
		assertGlobalActor(ctx, CATALOG_SCOPE);
		await AdminCatalogEndpoints.service.daos.writer.resetPlan(ctx.params.axis, ctx.params.tier);
		return { ok: true };
	}
}
