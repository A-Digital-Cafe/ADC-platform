import { Schema } from "mongoose";

/**
 * Colección vieja de excepciones de `StorageQuotaService` (en bytes), hoy overrides de la feature
 * `storage.total`. La consume `dao/legacyStorageMigration.ts`; se conserva como respaldo y ambos se
 * pueden borrar una vez consolidado el despliegue.
 */
export interface LegacyStorageOverrideDoc {
	id: string;
	subjectType: "user" | "org" | "role" | "org-members-default";
	subjectId: string;
	orgId: string | null;
	limitBytes: number;
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
	/** Presente ⇒ ya se copió a `plan_overrides`. */
	migratedAt?: Date;
}

export const legacyStorageOverrideSchema = new Schema<LegacyStorageOverrideDoc>(
	{
		id: { type: String, required: true },
		subjectType: { type: String, required: true, enum: ["user", "org", "role", "org-members-default"] },
		subjectId: { type: String, required: true, maxlength: 80 },
		orgId: { type: String, default: null, maxlength: 80 },
		limitBytes: { type: Number, required: true, min: -1 },
		createdBy: { type: String, required: true, maxlength: 64 },
		createdAt: { type: Date, default: Date.now },
		updatedAt: { type: Date, default: Date.now },
		migratedAt: { type: Date },
	},
	{ id: false, versionKey: false, collection: "storage_limit_overrides" }
);
