import { Schema } from "mongoose";
import type { User } from "@common/types/identity/User.ts";
export const userSchema = new Schema<User>(
	{
		id: { type: String, required: true, unique: true },
		username: { type: String, required: true, unique: true },
		passwordHash: { type: String, required: true },
		email: String,
		roleIds: [String],
		groupIds: [String],
		orgMemberships: [
			{
				orgId: String,
				roleIds: [String],
				joinedAt: Date,
			},
		],
		linkedAccounts: [
			{
				provider: { type: String, required: true },
				providerId: { type: String, required: true },
				providerUsername: String,
				providerAvatar: String,
				status: { type: String, enum: ["linked", "unlinked"], default: "linked" },
				linkedAt: { type: Date, default: Date.now },
				unlinkedAt: Date,
			},
		],
		permissions: [
			{
				resource: { type: String, required: true },
				action: { type: Number, required: true }, // Bitfield
				scope: { type: Number, required: true }, // Bitfield
			},
		],
		metadata: Schema.Types.Mixed,
		isActive: { type: Boolean, default: true },
		createdAt: { type: Date, default: Date.now },
		updatedAt: { type: Date, default: Date.now },
		lastLogin: Date,
	},
	{ id: false }
);

/**
 * Campos que el update genérico (`UserManager.updateUser`) puede escribir, vía `buildUpdateSet`.
 *
 * `passwordHash` y `lastLogin` quedan FUERA a propósito: tienen sus propios flujos. `id` y
 * `createdAt` son inmutables.
 */
export const USER_UPDATABLE_FIELDS = [
	"username",
	"email",
	"avatar",
	"isActive",
	"roleIds",
	"groupIds",
	"permissions",
	"orgMemberships",
	"linkedAccounts",
	"metadata",
] as const;
