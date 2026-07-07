import { Schema } from "mongoose";
import type { Role } from "@common/types/identity/Role.ts";

export const roleSchema = new Schema<Role>(
	{
		id: { type: String, required: true, unique: true },
		name: { type: String, required: true },
		description: String,
		permissions: [
			{
				resource: { type: String, required: true },
				action: { type: Number, required: true }, // Bitfield
				scope: { type: Number, required: true }, // Bitfield
			},
		],
		isCustom: { type: Boolean, default: false },
		orgId: { type: String, default: null, index: true },
		// Orden del rol (mayor = más autoridad); docs previos sin el campo cuentan como 100.
		hierarchy: { type: Number, default: 100 },
		createdAt: { type: Date, default: Date.now },
		updatedAt: { type: Date, default: Date.now },
	},
	{ id: false } // Disable Mongoose virtual id getter to avoid conflicts with custom id field
);
