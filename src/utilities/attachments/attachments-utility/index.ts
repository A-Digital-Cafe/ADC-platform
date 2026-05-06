import type { Connection } from "mongoose";
import { BaseUtility } from "../../BaseUtility.js";
import { getOrCreateAttachmentModel } from "./schemas/attachment.schema.js";
import {
	AttachmentsManager,
	type AttachmentsManagerOptions,
	type AttachmentPermissionChecker,
	type AttachmentPermissionContext,
	type AttachmentAction,
	type S3Like,
	type SubPathContext,
	type PresignUploadInput,
	type PresignUploadResult,
} from "./managers/AttachmentsManager.js";

export type {
	AttachmentsManagerOptions,
	AttachmentPermissionChecker,
	AttachmentPermissionContext,
	AttachmentAction,
	S3Like,
	SubPathContext,
	PresignUploadInput,
	PresignUploadResult,
};
export { AttachmentsManager };

export interface CreateAttachmentsManagerOptions extends Omit<AttachmentsManagerOptions, "model"> {
	mongoConnection: Connection;
	collectionName: string;
}

export default class AttachmentsUtility extends BaseUtility {
	public readonly name = "attachments-utility";

	createAttachmentsManager(opts: CreateAttachmentsManagerOptions): AttachmentsManager {
		const model = getOrCreateAttachmentModel(opts.mongoConnection, opts.collectionName);
		return new AttachmentsManager({
			model,
			s3Provider: opts.s3Provider,
			bucket: opts.bucket,
			basePath: opts.basePath,
			subPathResolver: opts.subPathResolver,
			permissionChecker: opts.permissionChecker,
			maxSize: opts.maxSize,
			allowedMimeTypes: opts.allowedMimeTypes,
			presignTtl: opts.presignTtl,
		});
	}
}
