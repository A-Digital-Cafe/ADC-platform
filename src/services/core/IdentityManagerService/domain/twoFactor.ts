import { Schema } from "mongoose";
import type { UserTwoFactor } from "@common/types/identity/TwoFactor.ts";

export const userTwoFactorSchema = new Schema<UserTwoFactor>(
	{
		userId: { type: String, required: true, unique: true, index: true },
		secret: { type: String, required: true },
		enabled: { type: Boolean, default: false },
		createdAt: { type: Date, default: Date.now },
		confirmedAt: Date,
		lastStep: Number,
		recoveryCodes: [
			{
				hash: { type: String, required: true },
				usedAt: Date,
			},
		],
	},
	{ id: false }
);
