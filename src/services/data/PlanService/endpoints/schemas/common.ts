import { Type } from "@sinclair/typebox";

/**
 * Piezas TypeBox compartidas por los schemas del servicio.
 *
 * El valor de una feature es `number | boolean | string` (límite, flag o enum),
 * por eso `FeatureValue` es una unión y no un entero.
 */

export const OkResponse = Type.Object({ ok: Type.Boolean() });

export const FeatureValue = Type.Union([Type.Number(), Type.Boolean(), Type.String()], {
	description: "Límite numérico (-1 = sin tope), flag o variante enum",
});

const ScaledValue = Type.Object({
	base: Type.Number(),
	perSeat: Type.Optional(Type.Number({ description: "Incremento por asiento pago" })),
});

/** Valor tal como se guarda en un plan: plano o escalable por asiento. */
export const PlanFeatureValue = Type.Union([FeatureValue, ScaledValue]);

export const PlanAxis = Type.Union([Type.Literal("user"), Type.Literal("org")]);

export const OrgIdParams = Type.Object({
	orgId: Type.String({ minLength: 1, description: "ID de la organización" }),
});

/** Los query params numéricos llegan como string: el validador no coerciona tipos. */
export const PagingQuery = {
	limit: Type.Optional(Type.String({ pattern: String.raw`^\d+$`, description: "Tamaño de página (clampeado en el servidor)" })),
	offset: Type.Optional(Type.String({ pattern: String.raw`^\d+$` })),
};
