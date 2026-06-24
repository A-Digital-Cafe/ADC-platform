import type { Connection } from "mongoose";
import { BaseUtility } from "../../BaseUtility.js";
import { getOrCreateAttachmentModel } from "./schemas/attachment.schema.js";
import { AttachmentsManager, type AttachmentsManagerOptions } from "./managers/AttachmentsManager.js";
import { UserKeyStore, resolveStorageMasterKey } from "./crypto/userKeys.js";

export type { AttachmentsManagerOptions };
export { AttachmentsManager, UserKeyStore, resolveStorageMasterKey };

export interface CreateAttachmentsManagerOptions extends Omit<AttachmentsManagerOptions, "model"> {
	mongoConnection: Connection;
	collectionName: string;
}

export interface CreateUserKeyStoreOptions {
	mongoConnection: Connection;
	/** Colección de DEKs envueltas, una por app (ej: "drive_user_keys"). */
	collectionName: string;
	logger?: { logWarn(msg: string): void };
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
			kernelKey: opts.kernelKey,
			quota: opts.quota,
			encryption: opts.encryption,
			logger: opts.logger,
			onQuotaExceeded: opts.onQuotaExceeded,
		});
	}

	/**
	 * Almacén de DEKs por usuario (envelope encryption con la master key de la
	 * plataforma: `ADC_STORAGE_MASTER_KEY`). Compartir la misma instancia entre el
	 * manager y otros consumidores del servicio (ej: archivos zip temporales).
	 */
	createUserKeyStore(opts: CreateUserKeyStoreOptions): UserKeyStore {
		return new UserKeyStore({
			connection: opts.mongoConnection,
			collectionName: opts.collectionName,
			masterKey: resolveStorageMasterKey(opts.logger),
		});
	}
}

export {
	type AttachmentsQuotaOptions,
	type AttachmentPermissionChecker,
	type AttachmentPermissionContext,
	type AttachmentAction,
	type S3Like,
	type SubPathContext,
	type PresignUploadInput,
	type PresignUploadResult,
} from "./managers/AttachmentsManager.js";

export { createObjectCipher, createObjectDecipher } from "./crypto/userKeys.js";
