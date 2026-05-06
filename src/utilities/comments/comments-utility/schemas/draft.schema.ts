import { Schema, type Connection, type Model } from "mongoose";
import type { CommentDraft } from "../../../../common/types/comments/Comment.js";

/**
 * Forma persistida del draft. Reutiliza `CommentDraft` (DTO) reemplazando
 * `id` por `_id` y `updatedAt` ISO por `Date`.
 */
export type CommentDraftDoc = Omit<CommentDraft, "id" | "updatedAt"> & {
	_id: string;
	updatedAt: Date;
};

export function buildCommentDraftSchema(): Schema<CommentDraftDoc> {
	const schema = new Schema<CommentDraftDoc>(
		{
			_id: { type: String, required: true } as any,
			ownerId: { type: String, required: true, maxlength: 64, index: true },
			targetType: { type: String, required: true, maxlength: 40 },
			targetId: { type: String, required: true, maxlength: 80 },
			parentId: { type: String, default: null },
			editingCommentId: { type: String, default: null },
			blocks: { type: [Schema.Types.Mixed], default: [] } as any,
			attachmentIds: { type: [String], default: [] },
			updatedAt: { type: Date, required: true, default: () => new Date() },
		},
		{
			versionKey: false,
			id: false,
			_id: false,
			toJSON: { virtuals: true },
			toObject: { virtuals: true },
		}
	);

	schema.virtual("id").get(function (this: any) {
		return String(this._id);
	});

	schema.index({ ownerId: 1, targetType: 1, targetId: 1, parentId: 1, editingCommentId: 1 }, { unique: true });
	// TTL: limpia drafts no actualizados en 30 días
	schema.index({ updatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

	return schema as unknown as Schema<CommentDraftDoc>;
}

export function getOrCreateCommentDraftModel(connection: Connection, collectionName: string): Model<CommentDraftDoc> {
	const modelName = `CommentDraft_${collectionName}`;
	try {
		return connection.model<CommentDraftDoc>(modelName);
	} catch {
		const schema = buildCommentDraftSchema();
		schema.set("collection", collectionName);
		return connection.model<CommentDraftDoc>(modelName, schema);
	}
}
