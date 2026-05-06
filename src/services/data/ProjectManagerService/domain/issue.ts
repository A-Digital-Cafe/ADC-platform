import { Schema } from "mongoose";
import type { Issue } from "@common/types/project-manager/Issue.ts";

export const issueSchema = new Schema<Issue>(
	{
		id: { type: String, required: true, unique: true },
		projectId: { type: String, required: true, index: true },
		key: { type: String, required: true },

		title: { type: String, required: true },
		description: { type: String, default: "" },

		columnKey: { type: String, required: true },
		category: { type: String, default: "task" },

		sprintId: { type: String, index: true },
		milestoneId: { type: String, index: true },

		reporterId: { type: String, required: true },
		assigneeIds: [String],
		assigneeGroupIds: [String],

		priority: {
			urgency: { type: Number, default: 0 },
			importance: { type: Number, default: 0 },
			difficulty: { type: Number, default: null },
		},
		storyPoints: Number,

		customFields: Schema.Types.Mixed,
		linkedIssues: [
			{
				linkTypeId: String,
				targetIssueId: String,
			},
		],

		updateLog: [
			{
				at: { type: Date, default: Date.now },
				byUserId: String,
				field: String,
				oldValue: Schema.Types.Mixed,
				newValue: Schema.Types.Mixed,
				reason: String,
			},
		],

		createdAt: { type: Date, default: Date.now },
		updatedAt: { type: Date, default: Date.now },
		closedAt: Date,
	},
	{ id: false }
);

issueSchema.index({ projectId: 1, key: 1 }, { unique: true });
issueSchema.index({ projectId: 1, columnKey: 1 });
issueSchema.index({ projectId: 1, sprintId: 1 });
issueSchema.index({ projectId: 1, milestoneId: 1 });
issueSchema.index({ title: "text", description: "text" });
