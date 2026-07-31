import { Schema } from "mongoose";
import type { PlanAxis, PlanFeatureValue, PlanPrice } from "@common/types/plans/index.ts";

/** Documento de un plan: los valores de features de un tier de un eje. */
export interface PlanDefinitionDoc {
	/** `<axis>:<tier>` — ver `planKey()`. */
	_id: string;
	axis: PlanAxis;
	tier: string;
	/** Precio de lista. Ausente ⇒ el plan no está a la venta. Sólo lo escribe el import de la oferta. */
	price?: PlanPrice;
	/** Asientos incluidos sin suscripción activa. Sólo `axis: "org"`. */
	includedSeats?: number;
	/** Mínimo y máximo de asientos contratables. Sólo `axis: "org"`. */
	minSeats?: number;
	maxSeats?: number;
	features: Record<string, PlanFeatureValue>;
	/** Tope por miembro sin override propio, clampeado al valor de la org. Sólo `axis: "org"`. */
	memberFeatures?: Record<string, PlanFeatureValue>;
	/** Valores que aplican cuando la organización tiene la ampliación otorgada. */
	expansionFeatures?: Record<string, PlanFeatureValue>;
	updatedAt: Date;
	/** `true` mientras nadie lo haya editado: el seed puede refrescarlo. */
	seeded: boolean;
}

/** Patch parcial de un plan desde el panel de administración. */
export interface UpdatePlanPatch {
	/** `null` explícito saca el plan de venta; ausente lo deja como está. */
	price?: PlanPrice | null;
	includedSeats?: number;
	features?: Record<string, PlanFeatureValue>;
	memberFeatures?: Record<string, PlanFeatureValue>;
}

/**
 * Un plan tal como llega en un import bulk (la publicación de la oferta privada).
 * Es la forma de entrada del `PlanWriter`, no un documento persistido: sólo trae
 * las claves que la oferta quiere pisar.
 */
export interface ImportPlanItem {
	axis: PlanAxis;
	tier: string;
	price?: PlanPrice;
	includedSeats?: number;
	minSeats?: number;
	maxSeats?: number;
	features?: Record<string, PlanFeatureValue>;
	memberFeatures?: Record<string, PlanFeatureValue>;
	expansionFeatures?: Record<string, PlanFeatureValue>;
}

/** Subdocumento y no `Mixed`: es plata, y el entero en unidades menores se valida en la base. */
const planPriceSchema = new Schema(
	{
		currency: { type: String, required: true, minlength: 3, maxlength: 3, uppercase: true },
		unitAmountMinor: { type: Number, required: true, min: 0, validate: Number.isInteger },
		perSeat: { type: Boolean },
	},
	{ _id: false }
);

export const planDefinitionSchema = new Schema<PlanDefinitionDoc>(
	{
		_id: { type: String, required: true },
		axis: { type: String, required: true, enum: ["user", "org"] },
		tier: { type: String, required: true, maxlength: 40 },
		price: { type: planPriceSchema },
		includedSeats: { type: Number, min: -1 },
		minSeats: { type: Number, min: 1 },
		maxSeats: { type: Number, min: 1 },
		features: { type: Schema.Types.Mixed, required: true, default: {} },
		memberFeatures: { type: Schema.Types.Mixed },
		expansionFeatures: { type: Schema.Types.Mixed },
		updatedAt: { type: Date, default: Date.now },
		seeded: { type: Boolean, default: true },
	},
	{ _id: false, versionKey: false }
);

planDefinitionSchema.index({ axis: 1 });
