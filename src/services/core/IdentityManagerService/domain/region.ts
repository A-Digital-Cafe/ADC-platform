import { Schema } from "mongoose";
import type { RegionInfo } from "@common/types/identity/Region.ts";

export const regionSchema = new Schema<RegionInfo>({
	path: { type: String, required: true, unique: true },
	isGlobal: { type: Boolean, default: false },
	isActive: { type: Boolean, default: true },
	// `objectConnectionUri` es la ÚNICA conexión que una región declara: es la que consume
	// `getObjectConnectionUri()` para abrir la base de la organización. Acá vivía también un
	// `cacheConnectionUri` que nadie leía; con el schema en strict, mongoose descarta la clave en
	// create y en update, así que un URI de Redis por región no se puede volver a persistir sin
	// declararlo de nuevo (y sin un consumidor real, ver README).
	metadata: {
		objectConnectionUri: String,
	},
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

/** Campos escribibles por `RegionManager.updateRegion`. `path` es la clave de búsqueda, no un campo actualizable. */
export const REGION_UPDATABLE_FIELDS = ["isGlobal", "isActive", "metadata"] as const;
