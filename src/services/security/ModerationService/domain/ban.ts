import { Schema } from "mongoose";
import type { BanRecord } from "@common/types/identity/Moderation.js";

export const banSchema = new Schema<BanRecord>(
	{
		id: { type: String, required: true, unique: true },
		emailHashes: { type: [String], default: [], index: true },
		ipHashes: { type: [String], default: [], index: true },
		reason: { type: String, default: "" },
		lastLoginAt: { type: Date, default: null },
		bannedAt: { type: Date, required: true, default: () => new Date() },
		expiresAt: { type: Date, default: null, index: true },
		source: { type: String, required: true, default: "manual" },
		externalId: { type: String, index: true, sparse: true },
		userId: { type: String, index: true, sparse: true },
		active: { type: Boolean, default: true, index: true },
		unbannedAt: { type: Date },
		unbanReason: { type: String },
	},
	{ id: false, versionKey: false }
);

// Composite index para deduplicar por origen externo (idempotencia con modlogs)
banSchema.index({ source: 1, externalId: 1 }, { unique: false, sparse: true });
