import { Schema } from "mongoose";
import type { Group } from "@common/types/identity/Group.ts";

export const groupSchema = new Schema<Group>(
	{
		id: { type: String, required: true, unique: true },
		name: { type: String, required: true },
		description: String,
		roleIds: [String],
		permissions: [
			{
				resource: { type: String, required: true },
				action: { type: Number, required: true }, // Bitfield
				scope: { type: Number, required: true }, // Bitfield
			},
		],
		orgId: { type: String, default: null, index: true },
		metadata: Schema.Types.Mixed,
		createdAt: { type: Date, default: Date.now },
		updatedAt: { type: Date, default: Date.now },
	},
	{ id: false }
);

/** Campos escribibles por `GroupManager.updateGroup`. */
export const GROUP_UPDATABLE_FIELDS = ["name", "description", "permissions", "roleIds", "orgId", "metadata"] as const;
