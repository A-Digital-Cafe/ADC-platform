import { Schema, type Connection, type Model } from "mongoose";
import type { Comment } from "../../../../common/types/comments/Comment.js";

/**
 * Forma persistida del comentario. Reutiliza la base `Comment` (DTO) y
 * sustituye únicamente los campos que difieren en Mongo: `_id` en lugar de
 * `id`, fechas como `Date` y `attachmentIds` en lugar de `attachments`.
 */
export type CommentDoc = Omit<Comment, "id" | "createdAt" | "updatedAt" | "attachments"> & {
	_id: string;
	attachmentIds: string[];
	createdAt: Date;
	updatedAt?: Date;
};

export function buildCommentSchema(): Schema<CommentDoc> {
	const schema = new Schema<CommentDoc>(
		{
			_id: { type: String, required: true } as any,
			targetType: { type: String, required: true, maxlength: 40, index: true },
			targetId: { type: String, required: true, maxlength: 80, index: true },
			parentId: { type: String, default: null, index: true },
			threadRootId: { type: String, required: true, index: true },
			depth: { type: Number, required: true, min: 0, max: 10 },
			authorId: { type: String, required: true, maxlength: 64, index: true },
			authorName: { type: String, maxlength: 64 },
			authorImage: { type: String, maxlength: 512 },
			blocks: { type: [Schema.Types.Mixed], default: [] } as any,
			attachmentIds: { type: [String], default: [] },
			reactions: { type: Schema.Types.Mixed, default: {} } as any,
			replyCount: { type: Number, default: 0, min: 0 },
			label: { type: String, maxlength: 40 },
			meta: { type: Schema.Types.Mixed },
			createdAt: { type: Date, required: true, default: () => new Date() },
			updatedAt: { type: Date },
			edited: { type: Boolean, default: false },
			deleted: { type: Boolean, default: false },
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

	schema.index({ targetType: 1, targetId: 1, parentId: 1, _id: -1 });
	schema.index({ threadRootId: 1, _id: 1 });

	return schema as unknown as Schema<CommentDoc>;
}

export function getOrCreateCommentModel(connection: Connection, collectionName: string): Model<CommentDoc> {
	const modelName = `Comment_${collectionName}`;
	try {
		return connection.model<CommentDoc>(modelName);
	} catch {
		const schema = buildCommentSchema();
		schema.set("collection", collectionName);
		return connection.model<CommentDoc>(modelName, schema);
	}
}
