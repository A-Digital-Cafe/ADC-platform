import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { Model } from "mongoose";
import type { Attachment, AttachmentDTO } from "../../../../common/types/attachments/Attachment.js";
import { ATTACHMENT_DEFAULT_ALLOWED_MIMES, ATTACHMENT_DEFAULT_MAX_SIZE } from "../../../../common/types/attachments/Attachment.js";
import type { AttachmentDoc } from "../schemas/attachment.schema.js";
import { AttachmentError } from "../../../../common/types/custom-errors/AttachmentError.ts";
import { OnlyKernel } from "../../../../utils/decorators/OnlyKernel.ts";
import type { QuotaTrackerGetter } from "../../../../common/types/storage/quota.ts";
import { ENCRYPTION_SCHEME, createObjectCipher, createObjectDecipher, type UserKeyStore } from "../crypto/userKeys.js";

export type AttachmentAction = "upload" | "read" | "delete";

export interface AttachmentPermissionContext {
	userId: string;
	/** Contexto de organización del caller (del token); alimenta el tracker de cuota. */
	orgId?: string | null;
}

/** Integración opcional con StorageQuotaService. */
export interface AttachmentsQuotaOptions {
	/** Identificador estable de la app consumidora (ej: "drive", "avatars"); el mínimo garantizado lo resuelve el servicio. */
	appId: string;
	/** Getter lazy del tracker; null si el servicio de cuotas no está disponible. */
	getTracker: QuotaTrackerGetter;
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
	putObject(input: {
		bucket?: string;
		key: string;
		body: Readable | Buffer;
		contentType?: string;
		contentLength?: number;
	}): Promise<{ bucket: string; key: string; etag: string | null }>;
	getObjectStream(input: { bucket?: string; key: string }): Promise<{ stream: Readable; contentType?: string; size?: number }>;
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
	kernelKey: symbol;
	/** Tracking/enforcement de cuota de almacenamiento (opcional, fail-open). */
	quota?: AttachmentsQuotaOptions;
	/**
	 * Cifrado en reposo por usuario (envelope encryption). Al confirmar la subida
	 * el objeto se re-escribe cifrado con la DEK del uploader; las descargas deben
	 * salir por `openDownloadStream` (las URLs presignadas devolverían ciphertext).
	 */
	encryption?: { keyStore: UserKeyStore };
	/** Logger opcional para avisos de cuota (fail-open). */
	logger?: { logWarn(msg: string): void };
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
	const bounded = name.slice(0, 240);
	const cleaned = bounded.replaceAll(FILE_NAME_SAFE, "_").replaceAll(/_+/g, "_").replace(/^_+/, "").replace(/_+$/, "");
	return cleaned.length > 0 ? cleaned.slice(0, 120) : "file";
}

function sanitizeSegment(seg: string): string {
	const bounded = seg.slice(0, 200);
	return (
		bounded
			.replaceAll(/[^A-Za-z0-9._-]+/g, "_")
			.replace(/^_+/, "")
			.replace(/_+$/, "") || "_"
	);
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
	readonly #quota?: AttachmentsQuotaOptions;
	readonly #encryption?: { keyStore: UserKeyStore };
	readonly #logger?: { logWarn(msg: string): void };
	// Pública para que `@OnlyKernel()` pueda leerla vía `this.kernelKey`.
	private kernelKey?: symbol;

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
		this.#quota = opts.quota;
		this.#encryption = opts.encryption;
		this.#logger = opts.logger;
		this.setKernelKey(opts.kernelKey);
	}

	private setKernelKey(key: symbol): void {
		if (this.kernelKey) {
			throw new Error("Kernel key ya está establecida");
		}
		this.kernelKey = key;
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

	/**
	 * Chequeo informativo de cuota previo al presign (fail-open: si el tracker no
	 * está disponible o falla, se permite y se loguea). El enforcement real y
	 * atómico ocurre en `confirmUpload` con el tamaño real del objeto.
	 */
	async #checkQuotaAllowance(ctx: AttachmentPermissionContext, sizeBytes: number): Promise<void> {
		if (!this.#quota) return;
		try {
			const tracker = this.#quota.getTracker();
			if (!tracker) return;
			const result = await tracker.checkAllowance({ userId: ctx.userId, orgId: ctx.orgId ?? null }, this.#quota.appId, sizeBytes);
			if (!result.allowed) {
				throw new AttachmentError(413, "ATTACHMENT_QUOTA_EXCEEDED", "Cuota de almacenamiento agotada", {
					usedTotal: result.usedTotal,
					effectiveLimit: result.effectiveLimit,
				});
			}
		} catch (e) {
			if (e instanceof AttachmentError) throw e;
			this.#logger?.logWarn(`Attachments(${this.#quota.appId}): tracker de cuota no disponible (${(e as Error).message}); se permite`);
		}
	}

	/** Comitea bytes contra la cuota; `false` solo si el tracker rechazó (agotada). */
	async #commitQuota(ctx: AttachmentPermissionContext, bytes: number): Promise<boolean> {
		if (!this.#quota) return true;
		try {
			const tracker = this.#quota.getTracker();
			if (!tracker) return true;
			return await tracker.commit({ userId: ctx.userId, orgId: ctx.orgId ?? null }, this.#quota.appId, bytes);
		} catch (e) {
			this.#logger?.logWarn(`Attachments(${this.#quota.appId}): commit de cuota falló (${(e as Error).message}); se permite`);
			return true;
		}
	}

	/** Libera bytes comiteados (solo attachments `ready`) en el contexto donde se subieron. Nunca lanza. */
	async #releaseQuota(uploadedBy: string, orgId: string | null, bytes: number): Promise<void> {
		if (!this.#quota || bytes <= 0) return;
		try {
			const tracker = this.#quota.getTracker();
			await tracker?.release({ userId: uploadedBy, orgId }, this.#quota.appId, bytes);
		} catch (e) {
			this.#logger?.logWarn(`Attachments(${this.#quota.appId}): release de cuota falló (${(e as Error).message})`);
		}
	}

	async presignUpload(ctx: AttachmentPermissionContext, input: PresignUploadInput): Promise<PresignUploadResult> {
		this.#validateUploadInput(input);
		const subCtx: SubPathContext = { ...ctx, ownerType: input.ownerType, ownerId: input.ownerId };
		await this.#checkPermission("upload", subCtx);
		await this.#checkQuotaAllowance(ctx, input.size);

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
			orgId: ctx.orgId ?? null,
			createdAt: new Date(),
		});

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

		// Enforcement real de cuota con el tamaño verificado en S3 (no el declarado
		// por el cliente). Si no entra, se revierte la subida completa.
		const committed = await this.#commitQuota(ctx, head.size);
		if (!committed) {
			try {
				await this.#s3.deleteObject({ bucket: attachment.bucket, key: attachment.storageKey });
			} catch {
				// el GC de pending limpiará el objeto si este delete falla
			}
			await this.#model.deleteOne({ _id: attachmentId });
			throw new AttachmentError(413, "ATTACHMENT_QUOTA_EXCEEDED", "Cuota de almacenamiento agotada");
		}

		// Cifrado en reposo: re-escribe el objeto cifrado con la DEK del uploader.
		// El PUT presignado llega en claro; esta ventana se cierra acá (y el GC de
		// pending limpia los huérfanos si el proceso muere en el medio).
		let encryptionSet: Record<string, unknown> = {};
		if (this.#encryption) {
			try {
				encryptionSet = await this.#encryptObject(attachment, head.size);
			} catch (e) {
				await this.#releaseQuota(attachment.uploadedBy, attachment.orgId, head.size);
				throw new AttachmentError(500, "ATTACHMENT_ENCRYPTION_FAILED", `No se pudo cifrar el adjunto: ${(e as Error).message}`);
			}
		}

		await this.#model.updateOne(
			{ _id: attachmentId },
			{
				$set: {
					status: "ready",
					etag: head.etag ?? null,
					size: head.size,
					uploadedAt: new Date(),
					...encryptionSet,
				},
			}
		);

		const refreshed = await this.#model.findById(attachmentId).lean<AttachmentDoc & { _id: string }>();
		return refreshed ? this.#docToAttachment(refreshed) : { ...attachment, status: "ready" };
	}

	/**
	 * Re-escribe el objeto en claro como ciphertext AES-256-GCM bajo `<key>.enc`
	 * y borra el original. Devuelve el `$set` con storageKey + metadata de cifrado.
	 * GCM no expande el payload (el auth tag va al doc), así que ContentLength es
	 * el tamaño en claro.
	 */
	async #encryptObject(attachment: Attachment, size: number): Promise<Record<string, unknown>> {
		const keyStore = this.#encryption!.keyStore;
		const dek = await keyStore.getUserKey(attachment.uploadedBy);
		const { iv, cipher } = createObjectCipher(dek);
		const source = await this.#s3.getObjectStream({ bucket: attachment.bucket, key: attachment.storageKey });
		const encryptedKey = `${attachment.storageKey}.enc`;
		try {
			await this.#s3.putObject({
				bucket: attachment.bucket,
				key: encryptedKey,
				body: source.stream.pipe(cipher),
				contentType: "application/octet-stream",
				contentLength: size,
			});
		} catch (e) {
			source.stream.destroy();
			await this.#s3.deleteObject({ bucket: attachment.bucket, key: encryptedKey }).catch(() => undefined);
			throw e;
		}
		await this.#s3.deleteObject({ bucket: attachment.bucket, key: attachment.storageKey }).catch(() => undefined);
		return {
			storageKey: encryptedKey,
			encryption: {
				scheme: ENCRYPTION_SCHEME,
				iv: iv.toString("base64"),
				authTag: cipher.getAuthTag().toString("base64"),
				keyRef: attachment.uploadedBy,
			},
		};
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
		const attachment = await this.#getReadyForRead(ctx, attachmentId);
		if (attachment.encryption) {
			// Una URL presignada devolvería ciphertext: el consumer debe proxyear
			// la descarga con `openDownloadStream`.
			throw new AttachmentError(409, "ATTACHMENT_ENCRYPTED", "Adjunto cifrado: descargar vía streaming del servicio");
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

	/**
	 * Stream de descarga del binario (descifrado al vuelo si está cifrado).
	 * Mismo modelo de permisos que `getDownloadUrl`; pensado para que el servicio
	 * lo proxyee por HTTP con sus propios headers de disposición.
	 */
	async openDownloadStream(ctx: AttachmentPermissionContext, attachmentId: string): Promise<{ stream: Readable; attachment: Attachment }> {
		const attachment = await this.#getReadyForRead(ctx, attachmentId);
		const object = await this.#s3.getObjectStream({ bucket: attachment.bucket, key: attachment.storageKey });
		if (!attachment.encryption) return { stream: object.stream, attachment };
		if (!this.#encryption) {
			throw new AttachmentError(409, "ATTACHMENT_ENCRYPTED", "Adjunto cifrado pero el manager no tiene keyStore configurado");
		}
		const dek = await this.#encryption.keyStore.getUserKey(attachment.encryption.keyRef);
		const decipher = createObjectDecipher(dek, attachment.encryption.iv, attachment.encryption.authTag);
		const stream = object.stream.pipe(decipher);
		// Propagar errores de la fuente al stream resultante (pipe no lo hace solo).
		object.stream.on("error", (err) => decipher.destroy(err));
		return { stream, attachment };
	}

	async #getReadyForRead(ctx: AttachmentPermissionContext, attachmentId: string): Promise<Attachment> {
		const attachment = await this.getById(ctx, attachmentId);
		if (!attachment) {
			throw new AttachmentError(404, "ATTACHMENT_NOT_FOUND", "Adjunto no encontrado");
		}
		if (attachment.status !== "ready") {
			throw new AttachmentError(409, "ATTACHMENT_PENDING", "Adjunto aún no disponible");
		}
		return attachment;
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
		// Los `pending` nunca comitearon cuota; solo se liberan los `ready`.
		if (attachment!.status === "ready") {
			await this.#releaseQuota(attachment!.uploadedBy, attachment!.orgId, attachment!.size);
		}
	}

	/**
	 * ⚠️ Borrado interno sin pasar por `permissionChecker`. Únicamente para uso
	 * desde otros managers/servicios de confianza dentro del mismo bounded
	 * context (p.ej. `CommentsManager` haciendo GC de adjuntos huérfanos tras
	 * borrar un comentario, donde la autorización ya fue evaluada al borrar el
	 * comentario padre). Protegido por `@OnlyKernel()`.
	 */
	@OnlyKernel()
	async forceDelete(_kernelKey: symbol, attachmentId: string): Promise<void> {
		const doc = await this.#model.findById(attachmentId).lean<AttachmentDoc & { _id: string }>();
		if (!doc) return;
		try {
			await this.#s3.deleteObject({ bucket: doc.bucket, key: doc.storageKey });
		} catch {
			// si el objeto no existe en S3, igual borramos el doc
		}
		await this.#model.deleteOne({ _id: attachmentId });
		if (doc.status === "ready") await this.#releaseQuota(doc.uploadedBy, doc.orgId ?? null, doc.size);
	}

	/**
	 * ⚠️ Retención legal: marca un adjunto `ready` como `retained` y LIBERA su cuota,
	 * SIN borrar el objeto en S3. El binario se conserva (no descargable, no cuenta
	 * cuota) hasta una purga real (`forceDelete`) o su recuperación (`unretain`).
	 * Para cascadas de confianza (la autorización ya fue evaluada). `@OnlyKernel()`.
	 */
	@OnlyKernel()
	async retain(_kernelKey: symbol, attachmentId: string): Promise<void> {
		const doc = await this.#model.findById(attachmentId).lean<AttachmentDoc & { _id: string }>();
		if (doc?.status !== "ready") return;
		await this.#model.updateOne({ _id: attachmentId }, { $set: { status: "retained" } });
		await this.#releaseQuota(doc.uploadedBy, doc.orgId ?? null, doc.size);
	}

	/**
	 * ⚠️ Recuperación de un adjunto `retained`: vuelve a `ready` y re-comitea su cuota.
	 * El commit es incondicional (override de admin): la recuperación no debe fallar por
	 * cuota agotada. Para cascadas de confianza. `@OnlyKernel()`.
	 */
	@OnlyKernel()
	async unretain(_kernelKey: symbol, attachmentId: string): Promise<void> {
		const doc = await this.#model.findById(attachmentId).lean<AttachmentDoc & { _id: string }>();
		if (doc?.status !== "retained") return;
		await this.#model.updateOne({ _id: attachmentId }, { $set: { status: "ready" } });
		await this.#commitQuota({ userId: doc.uploadedBy, orgId: doc.orgId ?? null }, doc.size);
	}

	/**
	 * ⚠️ Borrado masivo sin `permissionChecker` de TODOS los adjuntos de un
	 * `(ownerType, ownerId)`, incluyendo objetos S3. Para cascadas de confianza
	 * (p.ej. purga de cuenta tras retención). Protegido por `@OnlyKernel()`.
	 * Devuelve la cantidad de docs eliminados.
	 */
	@OnlyKernel()
	async forceDeleteByOwner(_kernelKey: symbol, ownerType: string, ownerId: string): Promise<number> {
		const docs = await this.#model.find({ ownerType, ownerId }).lean<Array<AttachmentDoc & { _id: string }>>();
		let removed = 0;
		for (const d of docs) {
			try {
				await this.#s3.deleteObject({ bucket: d.bucket, key: d.storageKey });
			} catch {
				// continuar: si el objeto no existe en S3, igual borramos el doc
			}
			await this.#model.deleteOne({ _id: d._id });
			if (d.status === "ready") await this.#releaseQuota(d.uploadedBy, d.orgId ?? null, d.size);
			removed++;
		}
		return removed;
	}

	/**
	 * ⚠️ Borrado masivo por prefijo de `subPath` dentro de un `basePath`,
	 * incluyendo objetos S3. Útil cuando los adjuntos se agrupan por una ruta
	 * derivada (p.ej. `email` → `${userId}/...`). Para cascadas de confianza
	 * (purga de cuenta tras retención). Protegido por `@OnlyKernel()`.
	 */
	@OnlyKernel()
	async forceDeleteBySubPathPrefix(_kernelKey: symbol, basePath: string, subPathPrefix: string): Promise<number> {
		const escaped = subPathPrefix.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
		const docs = await this.#model.find({ basePath, subPath: { $regex: `^${escaped}` } }).lean<Array<AttachmentDoc & { _id: string }>>();
		let removed = 0;
		for (const d of docs) {
			try {
				await this.#s3.deleteObject({ bucket: d.bucket, key: d.storageKey });
			} catch {
				// continuar: si el objeto no existe en S3, igual borramos el doc
			}
			await this.#model.deleteOne({ _id: d._id });
			if (d.status === "ready") await this.#releaseQuota(d.uploadedBy, d.orgId ?? null, d.size);
			removed++;
		}
		return removed;
	}

	/**
	 * Uso real por (usuario, contexto) de los attachments `ready` de ESTA
	 * colección/app. Alimenta `computeUsage` del registro en StorageQuotaService
	 * (reconciliación). Protegido por `@OnlyKernel()`.
	 */
	@OnlyKernel()
	async aggregateUsageByUser(_kernelKey: symbol): Promise<Array<{ userId: string; orgId: string | null; bytes: number; count: number }>> {
		const rows = await this.#model.aggregate<{ _id: { u: string; o: string | null }; bytes: number; count: number }>([
			{ $match: { status: "ready" } },
			{ $group: { _id: { u: "$uploadedBy", o: { $ifNull: ["$orgId", null] } }, bytes: { $sum: "$size" }, count: { $sum: 1 } } },
		]);
		return rows.map((r) => ({ userId: String(r._id.u), orgId: r._id.o ?? null, bytes: r.bytes, count: r.count }));
	}

	/**
	 * ⚠️ Operación de mantenimiento global. NO exponer por HTTP.
	 * Borra adjuntos `pending` cuya creación supera `olderThanMs`. Devuelve
	 * cantidad eliminada. Protegido por `@OnlyKernel()`: requiere construir el
	 * manager con `opts.kernelKey` y pasar la misma symbol al invocar.
	 */
	@OnlyKernel()
	async gc(_kernelKey: symbol, olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
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
		let uploadedAt = undefined;
		if (doc.uploadedAt) {
			uploadedAt = doc.uploadedAt instanceof Date ? doc.uploadedAt : new Date(doc.uploadedAt);
		}
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
			encryption: doc.encryption ?? null,
			uploadedBy: doc.uploadedBy,
			orgId: doc.orgId ?? null,
			createdAt: doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt),
			uploadedAt,
		};
	}
}
