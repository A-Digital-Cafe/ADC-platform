import { Schema } from "mongoose";
import type { StorageLimitOverride } from "@common/types/storage/quota.ts";

/**
 * Overrides de límite asignados desde Identity a usuarios, organizaciones o
 * roles. `orgId = null` → override global (solo administrable en contexto
 * global); `orgId = <id>` → scoped a esa organización (administrable por su
 * org admin, acotado al límite de la org). `org-members-default` (subjectId =
 * orgId) define el tope default por miembro de esa org y queda siempre
 * org-scoped.
 */
export const storageLimitOverrideSchema = new Schema<StorageLimitOverride>(
	{
		id: { type: String, required: true, unique: true },
		subjectType: { type: String, required: true, enum: ["user", "org", "role", "org-members-default"] },
		subjectId: { type: String, required: true, maxlength: 80 },
		orgId: { type: String, default: null, maxlength: 80 },
		limitBytes: { type: Number, required: true, min: -1 },
		createdBy: { type: String, required: true, maxlength: 64 },
		createdAt: { type: Date, default: Date.now },
		updatedAt: { type: Date, default: Date.now },
	},
	{ id: false, versionKey: false }
);

storageLimitOverrideSchema.index({ subjectType: 1, subjectId: 1, orgId: 1 }, { unique: true });
storageLimitOverrideSchema.index({ orgId: 1 });
