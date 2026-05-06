import { Schema } from "mongoose";
import type { Project } from "@common/types/project-manager/Project.ts";

export const projectSchema = new Schema<Project>(
	{
		id: { type: String, required: true, unique: true },
		orgId: { type: String, default: null, index: true },
		slug: { type: String, required: true },
		name: { type: String, required: true },
		description: String,
		ownerId: { type: String, required: true },
		visibility: { type: String, enum: ["private", "org", "public"], default: "org" },

		memberUserIds: [String],
		memberGroupIds: [String],
		roleOverrides: [
			{
				roleId: { type: String, required: true },
				permissions: [{ scope: Number, action: Number }],
			},
		],

		kanbanColumns: [
			{
				id: String,
				key: String,
				name: String,
				order: Number,
				color: String,
				isDone: { type: Boolean, default: false },
				isAuto: { type: Boolean, default: false },
			},
		],
		customFieldDefs: [
			{
				id: String,
				name: String,
				type: { type: String, enum: ["date", "label", "text", "user", "number", "badge"] },
				options: [String],
				badgeOptions: [{ name: String, color: String }],
				required: { type: Boolean, default: false },
			},
		],
		issueLinkTypes: [
			{
				id: String,
				name: String,
				inverseName: String,
				color: String,
			},
		],
		priorityStrategy: {
			id: { type: String, default: "matrix-eisenhower" },
			weights: {
				urgency: Number,
				importance: Number,
				difficulty: Number,
			},
			customFnId: String,
		},
		settings: {
			wipLimits: Schema.Types.Mixed,
			requireCommentOnFinalTransition: { type: Boolean, default: false },
		},

		issueCounter: { type: Number, default: 0 },

		createdAt: { type: Date, default: Date.now },
		updatedAt: { type: Date, default: Date.now },
	},
	{ id: false }
);

// Unicidad por (orgId, slug). orgId null → globales (único global por slug).
projectSchema.index({ orgId: 1, slug: 1 }, { unique: true });
