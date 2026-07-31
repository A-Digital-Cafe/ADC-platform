import { Type } from "@sinclair/typebox";
import { FeatureValue, PlanAxis } from "./common.ts";

/** Schemas de lo que ve el caller sobre sí mismo: entitlements y asientos. */

const UsageEntry = Type.Object({
	day: Type.Optional(Type.Integer({ minimum: 0 })),
	month: Type.Optional(Type.Integer({ minimum: 0 })),
	total: Type.Optional(Type.Integer({ minimum: 0 })),
});

export const EntitlementsResponse = Type.Object({
	subject: Type.Object({
		userId: Type.String(),
		orgId: Type.Union([Type.String(), Type.Null()]),
	}),
	axis: PlanAxis,
	tier: Type.String(),
	paidSeats: Type.Optional(Type.Integer({ description: "Asientos pagos; driver del escalado en el eje org" })),
	activeSeats: Type.Optional(Type.Integer({ description: "Miembros ocupando asiento" })),
	features: Type.Record(Type.String(), FeatureValue),
	usage: Type.Record(Type.String(), UsageEntry),
});

export const SeatsResponse = Type.Object({
	orgId: Type.String(),
	paidSeats: Type.Integer(),
	activeSeats: Type.Integer(),
});
