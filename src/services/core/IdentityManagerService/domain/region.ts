import { Schema } from "mongoose";
import type { RegionInfo } from "@common/types/identity/Region.ts";

export const regionSchema = new Schema<RegionInfo>({
	path: { type: String, required: true, unique: true },
	isGlobal: { type: Boolean, default: false },
	isActive: { type: Boolean, default: true },
	metadata: {
		objectConnectionUri: String,
		cacheConnectionUri: String,
	},
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

/** Campos escribibles por `RegionManager.updateRegion`. `path` es la clave de búsqueda, no un campo actualizable. */
export const REGION_UPDATABLE_FIELDS = ["isGlobal", "isActive", "metadata"] as const;
