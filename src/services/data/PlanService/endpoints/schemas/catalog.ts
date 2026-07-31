import { Type } from "@sinclair/typebox";
import { PlanAxis, PlanFeatureValue } from "./common.ts";

/** Schemas del catálogo: features vendibles, planes y su administración. */

const FeatureDefDto = Type.Object({
	key: Type.String(),
	module: Type.String(),
	label: Type.String(),
	kind: Type.Union([Type.Literal("quota"), Type.Literal("limit"), Type.Literal("flag"), Type.Literal("enum")]),
	unit: Type.Optional(Type.String()),
	window: Type.Optional(Type.String()),
	salesVisible: Type.Optional(Type.Boolean()),
	orgScaling: Type.Optional(Type.String()),
});

const PlanPriceDto = Type.Object({
	currency: Type.String({ minLength: 3, maxLength: 3, description: "ISO 4217, ej. `USD`" }),
	unitAmountMinor: Type.Integer({ minimum: 0, description: "Unidades menores enteras (centavos)" }),
	perSeat: Type.Optional(Type.Boolean({ description: "Eje org: el monto es precio × asientos" })),
});

const PlanDto = Type.Object({
	axis: PlanAxis,
	tier: Type.String(),
	price: Type.Optional(PlanPriceDto),
	includedSeats: Type.Optional(Type.Number()),
	features: Type.Record(Type.String(), PlanFeatureValue),
});

export const CatalogResponse = Type.Object({
	features: Type.Array(FeatureDefDto),
	plans: Type.Array(PlanDto),
});

export const PlanParams = Type.Object({
	axis: PlanAxis,
	tier: Type.String({ minLength: 1 }),
});

export const UpdatePlanBody = Type.Object({
	price: Type.Optional(
		Type.Union([PlanPriceDto, Type.Null()], { description: "`null` saca el plan de venta; ausente deja el precio como está" })
	),
	includedSeats: Type.Optional(Type.Integer({ minimum: -1 })),
	features: Type.Optional(Type.Record(Type.String(), PlanFeatureValue, { description: "Merge parcial sobre las features actuales" })),
	memberFeatures: Type.Optional(
		Type.Record(Type.String(), PlanFeatureValue, { description: "Tope por miembro de la organización, sin override propio" })
	),
});

const ImportPlanItem = Type.Object({
	axis: PlanAxis,
	tier: Type.String({ minLength: 1, maxLength: 40 }),
	price: Type.Optional(PlanPriceDto),
	includedSeats: Type.Optional(Type.Integer({ minimum: -1 })),
	minSeats: Type.Optional(Type.Integer({ minimum: 1 })),
	maxSeats: Type.Optional(Type.Integer({ minimum: 1 })),
	features: Type.Optional(Type.Record(Type.String(), PlanFeatureValue, { description: "Merge parcial sobre las features actuales" })),
	memberFeatures: Type.Optional(Type.Record(Type.String(), PlanFeatureValue)),
	expansionFeatures: Type.Optional(Type.Record(Type.String(), PlanFeatureValue)),
});

export const ImportPlansBody = Type.Object({
	plans: Type.Array(ImportPlanItem, { minItems: 1, maxItems: 20 }),
});

export const ImportPlansResponse = Type.Object({
	ok: Type.Boolean(),
	updated: Type.Array(Type.String({ description: "`<axis>:<tier>` de cada plan actualizado" })),
});
