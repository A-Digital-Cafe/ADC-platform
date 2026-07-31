import { Schema } from "mongoose";
import type { PlanOverride } from "@common/types/plans/index.ts";

export type { PlanSubjectType } from "@common/types/plans/index.ts";

/**
 * Excepción de límite persistida, por feature. Es la **única** colección de excepciones de la
 * plataforma. La forma vive en `@common` para que otros módulos administren las suyas por interfaz
 * (`IPlanService.overridesAdmin`) sin importar esta clase.
 */
export type PlanOverrideDoc = PlanOverride;

export const planOverrideSchema = new Schema<PlanOverrideDoc>(
	{
		id: { type: String, required: true, unique: true },
		subjectType: { type: String, required: true, enum: ["user", "org", "role", "org-members-default"] },
		subjectId: { type: String, required: true, maxlength: 80 },
		orgId: { type: String, default: null, maxlength: 80 },
		featureKey: { type: String, required: true, maxlength: 120 },
		value: { type: Schema.Types.Mixed, required: true },
		createdBy: { type: String, required: true, maxlength: 64 },
		createdAt: { type: Date, default: Date.now },
		updatedAt: { type: Date, default: Date.now },
	},
	{ id: false, versionKey: false }
);

planOverrideSchema.index({ subjectType: 1, subjectId: 1, orgId: 1, featureKey: 1 }, { unique: true });
planOverrideSchema.index({ orgId: 1 });
planOverrideSchema.index({ featureKey: 1 });
/** Orden estable del listado administrativo (`id` desempata dentro del mismo instante). */
planOverrideSchema.index({ createdAt: -1, id: 1 });
