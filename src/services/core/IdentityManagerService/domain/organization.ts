import { Schema } from "mongoose";
import type { Organization } from "@common/types/identity/Organization.ts";

export const organizationSchema = new Schema<Organization>({
	orgId: { type: String, required: true, unique: true },
	slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
	region: { type: String, required: true, default: "default/default" },
	tier: { type: String, enum: ["default"], default: "default" },
	status: { type: String, enum: ["active", "inactive", "blocked"], default: "active" },
	approved: { type: Boolean, default: false },
	permissions: [
		{
			resource: { type: String, required: true },
			action: { type: Number, required: true }, // Bitfield
			scope: { type: Number, required: true }, // Bitfield
		},
	],
	metadata: Schema.Types.Mixed, // Contiene email, description, url
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

// Índices para performance
organizationSchema.index({ status: 1, createdAt: -1 });
organizationSchema.index({ approved: 1, createdAt: -1 });
organizationSchema.index({ slug: 1 });
