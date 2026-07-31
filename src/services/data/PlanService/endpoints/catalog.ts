import { RegisterEndpoint, type EndpointCtx } from "@services/core/EndpointManagerService/index.js";
import type PlanService from "../index.js";
import * as S from "./schemas/index.js";

/**
 * Catálogo público: alimenta la página de precios.
 *
 * Es **sin auth a propósito** — la oferta comercial es información pública, y que
 * la página se genere desde acá es lo que permite ajustar planes desde el panel de
 * administración sin tocar código ni desplegar.
 *
 * Sólo expone features marcadas `salesVisible`: los límites internos (topes de
 * seguridad, cuotas técnicas) no forman parte de la oferta.
 */
export class CatalogEndpoints {
	private static service: PlanService;
	private static kernelKey: symbol;

	static init(service: PlanService, kernelKey: symbol): void {
		CatalogEndpoints.service ??= service;
		CatalogEndpoints.kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/plans/catalog",
		requireAuth: false,
		options: {
			tag: "PlanService/Catalog",
			summary: "Catálogo público de planes y features vendibles",
			rateLimit: { max: 120, timeWindow: 60_000 },
			schema: { response: { 200: S.CatalogResponse } },
		},
	})
	static async catalog(_ctx: EndpointCtx) {
		const catalog = CatalogEndpoints.service.daos.catalog;
		const features = catalog.listFeatures().filter((f) => f.salesVisible);
		const visible = new Set(features.map((f) => f.key));

		const plans = (await catalog.listPlans()).map((p) => ({
			axis: p.axis,
			tier: p.tier,
			// El precio es público: la página de precios tiene que mostrarlo a un
			// visitante sin sesión. Ausente = plan gratuito o a medida.
			price: p.price,
			includedSeats: p.includedSeats,
			features: Object.fromEntries(Object.entries(p.features).filter(([key]) => visible.has(key))),
		}));

		return { features, plans };
	}
}
