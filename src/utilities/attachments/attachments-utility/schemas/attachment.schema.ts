import { Schema, type Connection, type Model } from "mongoose";
import type { Attachment, AttachmentStatus } from "../../../../common/types/attachments/Attachment.js";

export type AttachmentDoc = Omit<Attachment, "id"> & { _id: string };

function buildAttachmentSchema(): Schema<AttachmentDoc> {
	const schema = new Schema<AttachmentDoc>(
		{
			_id: { type: String, required: true } as any,
			basePath: { type: String, required: true, maxlength: 80 },
			subPath: { type: String, required: true, maxlength: 240 },
			ownerType: { type: String, required: true, maxlength: 40 },
			ownerId: { type: String, required: true, maxlength: 80 },
			fileName: { type: String, required: true, maxlength: 240 },
			mimeType: { type: String, required: true, maxlength: 120 },
			size: { type: Number, required: true, min: 0 },
			bucket: { type: String, required: true, maxlength: 80 },
			storageKey: { type: String, required: true, unique: true, maxlength: 600 },
			etag: { type: String, default: null },
			status: { type: String, required: true, enum: ["pending", "ready"] satisfies AttachmentStatus[], default: "pending", index: true },
			uploadedBy: { type: String, required: true, maxlength: 64, index: true },
			createdAt: { type: Date, required: true, default: () => new Date() },
			uploadedAt: { type: Date, default: null },
		},
		{
			versionKey: false,
			id: false,
			toJSON: { virtuals: true },
			toObject: { virtuals: true },
		}
	);

	schema.virtual("id").get(function (this: any) {
		return String(this._id);
	});

	schema.index({ basePath: 1, subPath: 1, ownerId: 1 });
	schema.index({ status: 1, createdAt: 1 });

	return schema as Schema<AttachmentDoc>;
}

export function getOrCreateAttachmentModel(connection: Connection, collectionName: string): Model<AttachmentDoc> {
	const modelName = `Attachment_${collectionName}`;
	try {
		return connection.model<AttachmentDoc>(modelName);
	} catch {
		const schema = buildAttachmentSchema();
		schema.set("collection", collectionName);
		return connection.model<AttachmentDoc>(modelName, schema);
	}
}
