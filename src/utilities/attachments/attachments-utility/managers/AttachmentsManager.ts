import { randomUUID } from "node:crypto";
import type { Model } from "mongoose";
import type { Attachment, AttachmentDTO } from "../../../../common/types/attachments/Attachment.js";
import { ATTACHMENT_DEFAULT_ALLOWED_MIMES, ATTACHMENT_DEFAULT_MAX_SIZE } from "../../../../common/types/attachments/Attachment.js";
import type { AttachmentDoc } from "../schemas/attachment.schema.js";
import { AttachmentError } from "../../../../common/types/custom-errors/AttachmentError.ts";
import { OnlyKernel } from "../../../../utils/decorators/OnlyKernel.ts";

export type AttachmentAction = "upload" | "read" | "delete";

export interface AttachmentPermissionContext {
	userId: string;
}

export type AttachmentPermissionChecker = (
	action: AttachmentAction,
	ctx: AttachmentPermissionContext,
	attachment?: Attachment
) => Promise<boolean> | boolean;

/** Subset de `internal-s3-provider` que el manager utiliza. */
export interface S3Like {
	getDefaultBucket(): string;
	getDefaultPresignTtl(): number;
	getPresignedUploadUrl(input: {
		bucket?: string;
		key: string;
		contentType?: string;
		contentLength?: number;
		ttl?: number;
	}): Promise<{ uploadUrl: string; bucket: string; key: string; headers: Record<string, string>; expiresIn: number; expiresAt: Date }>;
	getPresignedDownloadUrl(input: { bucket?: string; key: string; ttl?: number; filename?: string; inline?: boolean }): Promise<string>;
	headObject(input: { bucket?: string; key: string }): Promise<{ contentType?: string; size?: number; etag?: string }>;
	deleteObject(input: { bucket?: string; key: string }): Promise<void>;
}

export interface SubPathContext extends AttachmentPermissionContext {
	ownerType: string;
	ownerId: string;
}

export interface AttachmentsManagerOptions {
	model: Model<AttachmentDoc>;
	s3Provider: S3Like;
	bucket?: string;
	basePath: string;
	subPathResolver: (ctx: SubPathContext) => string;
	permissionChecker: AttachmentPermissionChecker;
	maxSize?: number;
	allowedMimeTypes?: ReadonlyArray<string> | null;
	presignTtl?: number;
	/**
	 * Si se provee, habilita métodos `@OnlyKernel()` (p.ej. `gc`) y se exige
	 * que el caller pase exactamente esta misma key como primer argumento.
	 */
	kernelKey?: symbol;
}

export interface PresignUploadInput {
	fileName: string;
	mimeType: string;
	size: number;
	ownerType: string;
	ownerId: string;
}

export interface PresignUploadResult {
	attachmentId: string;
	uploadUrl: string;
	key: string;
	bucket: string;
	headers: Record<string, string>;
	expiresAt: Date;
}

const FILE_NAME_SAFE = /[^A-Za-z0-9._-]+/g;

function safeFileName(name: string): string {
	const cleaned = name
		.replace(FILE_NAME_SAFE, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "");
	return cleaned.length > 0 ? cleaned.slice(0, 120) : "file";
}

function sanitizeSegment(seg: string): string {
	return seg.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "_";
}

export class AttachmentsManager {
	readonly #model: Model<AttachmentDoc>;
	readonly #s3: S3Like;
	readonly #bucket: string;
	readonly #basePath: string;
	readonly #subPathResolver: (ctx: SubPathContext) => string;
	readonly #permissionChecker: AttachmentPermissionChecker;
	readonly #maxSize: number;
	readonly #allowedMimes: ReadonlySet<string> | null;
	readonly #presignTtl: number;
	// Pública para que `@OnlyKernel()` pueda leerla vía `this.kernelKey`.
	readonly kernelKey?: symbol;

	constructor(opts: AttachmentsManagerOptions) {
		this.#model = opts.model;
		this.#s3 = opts.s3Provider;
		this.#bucket = opts.bucket ?? opts.s3Provider.getDefaultBucket();
		this.#basePath = sanitizeSegment(opts.basePath);
		this.#subPathResolver = opts.subPathResolver;
		this.#permissionChecker = opts.permissionChecker;
		this.#maxSize = opts.maxSize ?? ATTACHMENT_DEFAULT_MAX_SIZE;
		this.#allowedMimes = opts.allowedMimeTypes === null ? null : new Set(opts.allowedMimeTypes ?? ATTACHMENT_DEFAULT_ALLOWED_MIMES);
		this.#presignTtl = opts.presignTtl ?? opts.s3Provider.getDefaultPresignTtl();
		this.kernelKey = opts.kernelKey;
	}

	get bucket(): string {
		return this.#bucket;
	}

	get basePath(): string {
		return this.#basePath;
	}

	#buildKey(subPath: string, attachmentId: string, fileName: string): string {
		const subClean = subPath
			.split("/")
			.map(sanitizeSegment)
			.filter((s) => s !== "_")
			.join("/");
		const fname = safeFileName(fileName);
		return `${this.#basePath}/${subClean}/${attachmentId}-${fname}`;
	}

	async #checkPermission(action: AttachmentAction, ctx: AttachmentPermissionContext, attachment?: Attachment): Promise<void> {
		const ok = await this.#permissionChecker(action, ctx, attachment);
		if (!ok) {
			throw new AttachmentError(403, "ATTACHMENT_FORBIDDEN", `No autorizado para acción "${action}" sobre adjunto`);
		}
	}

	#validateUploadInput(input: PresignUploadInput): void {
		if (!input.fileName || typeof input.fileName !== "string") {
			throw new AttachmentError(400, "ATTACHMENT_BAD_INPUT", "fileName requerido");
		}
		if (!input.mimeType || typeof input.mimeType !== "string") {
			throw new AttachmentError(400, "ATTACHMENT_BAD_INPUT", "mimeType requerido");
		}
		if (typeof input.size !== "number" || !Number.isFinite(input.size) || input.size <= 0) {
			throw new AttachmentError(400, "ATTACHMENT_BAD_INPUT", "size inválido");
		}
		if (input.size > this.#maxSize) {
			throw new AttachmentError(413, "ATTACHMENT_TOO_LARGE", `Archivo supera el tamaño máximo (${this.#maxSize} bytes)`);
		}
		if (this.#allowedMimes && !this.#allowedMimes.has(input.mimeType)) {
			throw new AttachmentError(415, "ATTACHMENT_UNSUPPORTED_MIME", `mimeType no permitido: ${input.mimeType}`);
		}
	}

	async presignUpload(ctx: AttachmentPermissionContext, input: PresignUploadInput): Promise<PresignUploadResult> {
		this.#validateUploadInput(input);
		const subCtx: SubPathContext = { ...ctx, ownerType: input.ownerType, ownerId: input.ownerId };
		await this.#checkPermission("upload", subCtx);

		const attachmentId = randomUUID();
		const subPath = this.#subPathResolver(subCtx);
		const key = this.#buildKey(subPath, attachmentId, input.fileName);

		await this.#model.create({
			_id: attachmentId,
			basePath: this.#basePath,
			subPath,
			ownerType: input.ownerType,
			ownerId: input.ownerId,
			fileName: input.fileName,
			mimeType: input.mimeType,
			size: input.size,
			bucket: this.#bucket,
			storageKey: key,
			status: "pending",
			uploadedBy: ctx.userId,
			createdAt: new Date(),
		} as Partial<AttachmentDoc>);

		const presigned = await this.#s3.getPresignedUploadUrl({
			bucket: this.#bucket,
			key,
			contentType: input.mimeType,
			contentLength: input.size,
			ttl: this.#presignTtl,
		});

		return {
			attachmentId,
			uploadUrl: presigned.uploadUrl,
			key: presigned.key,
			bucket: presigned.bucket,
			headers: presigned.headers,
			expiresAt: presigned.expiresAt,
		};
	}

	async confirmUpload(ctx: AttachmentPermissionContext, attachmentId: string): Promise<Attachment> {
		const doc = await this.#model.findById(attachmentId).lean<AttachmentDoc & { _id: string }>();
		if (!doc) {
			throw new AttachmentError(404, "ATTACHMENT_NOT_FOUND", "Adjunto no encontrado");
		}
		const attachment = this.#docToAttachment(doc);
		await this.#checkPermission("upload", ctx, attachment);

		if (attachment.uploadedBy !== ctx.userId) {
			throw new AttachmentError(403, "ATTACHMENT_FORBIDDEN", "Solo el autor puede confirmar el upload");
		}
		if (attachment.status === "ready") {
			return attachment;
		}

		const head = await this.#s3.headObject({ bucket: attachment.bucket, key: attachment.storageKey });
		if (!head.size || head.size <= 0) {
			throw new AttachmentError(409, "ATTACHMENT_NOT_UPLOADED", "Objeto no encontrado en S3 tras upload");
		}

		await this.#model.updateOne(
			{ _id: attachmentId },
			{
				$set: {
					status: "ready",
					etag: head.etag ?? null,
					size: head.size,
					uploadedAt: new Date(),
				},
			}
		);

		const refreshed = await this.#model.findById(attachmentId).lean<AttachmentDoc & { _id: string }>();
		return refreshed ? this.#docToAttachment(refreshed) : { ...attachment, status: "ready" };
	}

	async getById(ctx: AttachmentPermissionContext, attachmentId: string): Promise<Attachment | null> {
		const doc = await this.#model.findById(attachmentId).lean<AttachmentDoc & { _id: string }>();
		if (!doc) return null;
		const attachment = this.#docToAttachment(doc);
		await this.#checkPermission("read", ctx, attachment);
		return attachment;
	}

	async getMany(ctx: AttachmentPermissionContext, ids: string[]): Promise<Attachment[]> {
		if (!ids.length) return [];
		const docs = await this.#model.find({ _id: { $in: ids } }).lean<Array<AttachmentDoc & { _id: string }>>();
		const attachments = docs.map((d) => this.#docToAttachment(d));
		const checked: Attachment[] = [];
		for (const att of attachments) {
			try {
				await this.#checkPermission("read", ctx, att);
				checked.push(att);
			} catch {
				// omitir los que el usuario no puede ver
			}
		}
		return checked;
	}

	/**
	 * Lista los adjuntos `ready` de un (ownerType, ownerId), ordenados por fecha
	 * descendente. Filtra por permiso `read` igual que `getMany`.
	 */
	async listByOwner(
		ctx: AttachmentPermissionContext,
		ownerType: string,
		ownerId: string,
		opts: { includePending?: boolean; limit?: number } = {}
	): Promise<Attachment[]> {
		const filter: Record<string, unknown> = { ownerType, ownerId };
		if (!opts.includePending) filter.status = "ready";
		const limit = Math.min(Math.max(1, opts.limit ?? 100), 500);
		const docs = await this.#model.find(filter).sort({ createdAt: -1 }).limit(limit).lean<Array<AttachmentDoc & { _id: string }>>();
		const attachments = docs.map((d) => this.#docToAttachment(d));
		const checked: Attachment[] = [];
		for (const att of attachments) {
			try {
				await this.#checkPermission("read", ctx, att);
				checked.push(att);
			} catch {
				/* skip */
			}
		}
		return checked;
	}

	async getDownloadUrl(
		ctx: AttachmentPermissionContext,
		attachmentId: string,
		opts: { ttl?: number; inline?: boolean } = {}
	): Promise<{ url: string; attachment: Attachment; expiresIn: number }> {
		const attachment = await this.getById(ctx, attachmentId);
		if (!attachment) {
			throw new AttachmentError(404, "ATTACHMENT_NOT_FOUND", "Adjunto no encontrado");
		}
		if (attachment.status !== "ready") {
			throw new AttachmentError(409, "ATTACHMENT_PENDING", "Adjunto aún no disponible");
		}
		const ttl = opts.ttl ?? this.#presignTtl;
		const url = await this.#s3.getPresignedDownloadUrl({
			bucket: attachment.bucket,
			key: attachment.storageKey,
			ttl,
			filename: attachment.fileName,
			inline: opts.inline,
		});
		return { url, attachment, expiresIn: ttl };
	}

	async delete(ctx: AttachmentPermissionContext, attachmentId: string): Promise<void> {
		// Auth-first delete: autorizar SIEMPRE antes de revelar la inexistencia.
		// El permissionChecker recibe `attachment=undefined` cuando el doc no existe;
		// el consumer decide la política (típicamente: solo admins pueden borrar
		// recursos no propios). Si pasa la autz y no existe, devolvemos silenciosamente.
		const doc = await this.#model.findById(attachmentId).lean<AttachmentDoc & { _id: string }>();
		const attachment = doc ? this.#docToAttachment(doc) : undefined;
		await this.#checkPermission("delete", ctx, attachment);
		if (!doc) return;

		try {
			await this.#s3.deleteObject({ bucket: attachment!.bucket, key: attachment!.storageKey });
		} catch {
			// ignorable: si el objeto no existe en S3, igual borramos el doc
		}
		await this.#model.deleteOne({ _id: attachmentId });
	}

	/**
	 * ⚠️ Operación de mantenimiento global. NO exponer por HTTP.
	 * Borra adjuntos `pending` cuya creación supera `olderThanMs`. Devuelve
	 * cantidad eliminada. Protegido por `@OnlyKernel()`: requiere construir el
	 * manager con `opts.kernelKey` y pasar la misma symbol al invocar.
	 */
	@OnlyKernel()
	async gc(_kernelKey: symbol, olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
		void _kernelKey;
		const threshold = new Date(Date.now() - olderThanMs);
		const docs = await this.#model.find({ status: "pending", createdAt: { $lt: threshold } }).lean<Array<AttachmentDoc & { _id: string }>>();
		let removed = 0;
		for (const d of docs) {
			try {
				await this.#s3.deleteObject({ bucket: d.bucket, key: d.storageKey });
			} catch {
				// continuar
			}
			await this.#model.deleteOne({ _id: d._id });
			removed++;
		}
		return removed;
	}

	toDto(att: Attachment): AttachmentDTO {
		return {
			id: att.id,
			fileName: att.fileName,
			mimeType: att.mimeType,
			size: att.size,
			status: att.status,
			uploadedBy: att.uploadedBy,
			uploadedAt: att.uploadedAt ? att.uploadedAt.toISOString() : undefined,
			createdAt: (att.createdAt instanceof Date ? att.createdAt : new Date(att.createdAt)).toISOString(),
		};
	}

	#docToAttachment(doc: AttachmentDoc & { _id: string }): Attachment {
		return {
			id: String(doc._id),
			basePath: doc.basePath,
			subPath: doc.subPath,
			ownerType: doc.ownerType,
			ownerId: doc.ownerId,
			fileName: doc.fileName,
			mimeType: doc.mimeType,
			size: doc.size,
			bucket: doc.bucket,
			storageKey: doc.storageKey,
			etag: doc.etag ?? null,
			status: doc.status,
			uploadedBy: doc.uploadedBy,
			createdAt: doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt),
			uploadedAt: doc.uploadedAt ? (doc.uploadedAt instanceof Date ? doc.uploadedAt : new Date(doc.uploadedAt)) : undefined,
		};
	}
}
