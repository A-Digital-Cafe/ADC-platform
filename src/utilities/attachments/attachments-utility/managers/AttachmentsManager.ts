import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { buffer as streamToBuffer } from "node:stream/consumers";
import type { Connection, Model } from "mongoose";
import type { Attachment, AttachmentDTO } from "../../../../common/types/attachments/Attachment.js";
import { ATTACHMENT_DEFAULT_ALLOWED_MIMES, ATTACHMENT_DEFAULT_MAX_SIZE } from "../../../../common/types/attachments/Attachment.js";
import type { AttachmentDoc } from "../schemas/attachment.schema.js";
import { getOrCreateUploadRateModel, rateBucketId, type UploadRateDoc } from "../schemas/uploadRate.schema.js";
import { AttachmentError } from "../../../../common/types/custom-errors/AttachmentError.ts";
import { isInlineSafeMime } from "../../../../common/utils/mime.ts";
import { trimChar } from "../../../../common/utils/strings.ts";
import { platformSetting } from "../../../../common/utils/platform-settings.ts";
import { OnlyKernel, bindKernelKey } from "../../../../utils/decorators/OnlyKernel.ts";
import { UNLIMITED_BYTES, type QuotaTrackerGetter } from "../../../../common/types/storage/quota.ts";
import { createObjectDecipher, type UserKeyStore } from "../crypto/userKeys.js";
import {
	CHUNKED_ENCRYPTION_SCHEME,
	ENCRYPTION_CHUNK_SIZE,
	chunkedCipherRange,
	decryptChunkedRange,
	encryptChunked,
	type PlainByteRange,
} from "../crypto/chunked.js";

export type AttachmentAction = "upload" | "read" | "delete";

export interface AttachmentPermissionContext {
	userId: string;
	/** Contexto de organización del caller (del token); alimenta el tracker de cuota. */
	orgId?: string | null;
}

/**
 * Topes anti-abuso de subida. Son **de caudal**, no de cuota: la cuota dice cuánto podés tener
 * guardado, esto dice a qué ritmo podés llegar a tenerlo.
 *
 * Existen porque el rate limit del borde no ve las subidas: el archivo no pasa por la plataforma
 * —el navegador lo manda directo al almacenamiento con una URL firmada—, así que lo único que ese
 * contador mide es cuántas veces pediste permiso, no cuántos bytes mandaste.
 */
export interface AttachmentsUploadLimits {
	/** Subidas firmadas y sin confirmar que un sujeto puede tener a la vez. `0` = sin tope. */
	maxConcurrent?: number;
	/** Bytes que un sujeto puede subir por hora, contados con el tamaño REAL. `0` = sin tope. */
	bytesPerHour?: number;
	/** Colección del contador horario. Sólo se crea si `bytesPerHour > 0`. */
	rateCollectionName?: string;
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
		publicHost?: string;
	}): Promise<{ uploadUrl: string; bucket: string; key: string; headers: Record<string, string>; expiresIn: number; expiresAt: Date }>;
	getPresignedDownloadUrl(input: {
		bucket?: string;
		key: string;
		ttl?: number;
		filename?: string;
		inline?: boolean;
		contentType?: string;
		publicHost?: string;
	}): Promise<string>;
	headObject(input: { bucket?: string; key: string }): Promise<{ contentType?: string; size?: number; etag?: string }>;
	deleteObject(input: { bucket?: string; key: string }): Promise<void>;
	putObject(input: {
		bucket?: string;
		key: string;
		body: Readable | Buffer;
		contentType?: string;
		contentLength?: number;
	}): Promise<{ bucket: string; key: string; etag: string | null }>;
	getObjectStream(input: {
		bucket?: string;
		key: string;
		/** Rango de bytes del objeto, extremos inclusive; el stream vuelve ya cortado. */
		range?: { start: number; end: number };
	}): Promise<{ stream: Readable; contentType?: string; size?: number }>;
}

export interface SubPathContext extends AttachmentPermissionContext {
	ownerType: string;
	ownerId: string;
}

/**
 * El provider de S3, o —preferido— un getter que lo resuelve en cada uso.
 *
 * Guardar la instancia la ata al momento del `start()` del consumidor: si el kernel recarga el
 * provider (edición en dev, deploy desde el panel), el consumidor se queda hablándole a una
 * instancia detenida y todo falla con 503 `S3_UNAVAILABLE` hasta reiniciar el kernel. Con el
 * getter, `getMyProvider(...)` —un lookup en un mapa— devuelve siempre la instancia vigente.
 * Mismo patrón que `AttachmentsQuotaOptions.getTracker`.
 */
export type S3Resolver = S3Like | (() => S3Like);

export interface AttachmentsManagerOptions {
	model: Model<AttachmentDoc>;
	s3Provider: S3Resolver;
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
	/** Topes de caudal de subida. Sin esto rigen los defaults de la utility. */
	uploadLimits?: AttachmentsUploadLimits;
	/**
	 * Cifrado en reposo por usuario (envelope encryption). Al confirmar la subida
	 * el objeto se re-escribe cifrado con la DEK del uploader; las descargas deben
	 * salir por `openDownloadStream` (las URLs presignadas devolverían ciphertext).
	 */
	encryption?: { keyStore: UserKeyStore };
	/** Logger opcional para avisos de cuota (fail-open). */
	logger?: { logWarn(msg: string): void };
	/**
	 * Hook best-effort que se dispara cuando un usuario alcanza su límite de cuota
	 * (antes de lanzar `ATTACHMENT_QUOTA_EXCEEDED`). Lo usa, p. ej., Drive para
	 * notificar "te quedaste sin espacio". No debe lanzar.
	 */
	onQuotaExceeded?: (userId: string, appId: string) => void;
}

/**
 * Defaults de los topes de caudal, pensados para no molestar a nadie real: cinco subidas a la vez
 * cubre un arrastre de carpeta desde el navegador y corta el caso de las mil firmas simultáneas;
 * 20 GB/hora es más de lo que sube un usuario en un día y aun así llena un disco de 1 TB en dos.
 */
const DEFAULT_MAX_CONCURRENT_UPLOADS = 5;
const DEFAULT_UPLOAD_BYTES_PER_HOUR = 20 * 1024 * 1024 * 1024;
const DEFAULT_RATE_COLLECTION = "attachment_upload_rate";

/**
 * El valor configurado para el clúster, si lo hay. La utility lo consulta por su cuenta y no lo
 * recibe de cada servicio porque son seis managers en cinco servicios distintos: un tope anti-abuso
 * que hay que cablear seis veces es un tope que en algún lado va a faltar. Un servicio que necesite
 * otro valor lo pasa igual por `uploadLimits`.
 */
function settingNumber(name: string): number | undefined {
	const raw = platformSetting(name);
	if (raw === undefined || raw.trim() === "") return undefined;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** `undefined` → default; `0` o negativo → sin tope (apagarlo tiene que ser explícito). */
function positiveOrZero(value: number | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export interface PresignUploadInput {
	fileName: string;
	mimeType: string;
	size: number;
	ownerType: string;
	ownerId: string;
	/**
	 * Host por el que el navegador llegó a la plataforma (`Host` del request, sin puerto).
	 * Con un S3 local, la URL se firma contra ese host para que la subida funcione desde
	 * otros dispositivos de la red; con un S3 real se ignora. Detalle en `PresignUploadInput`
	 * de `internal-s3-provider`.
	 */
	publicHost?: string;
}

export interface PresignUploadResult {
	attachmentId: string;
	uploadUrl: string;
	key: string;
	bucket: string;
	headers: Record<string, string>;
	expiresAt: Date;
}

/**
 * Valida un rango de descarga contra el tamaño en claro (el `416` ya lo respondió el caller HTTP:
 * uno inválido acá es un bug del caller). El rango completo se normaliza a "sin rango".
 */
function normalizeDownloadRange(range: { start: number; end: number } | undefined, size: number): PlainByteRange | undefined {
	if (!range) return undefined;
	if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.start > range.end || range.end >= size) {
		throw new AttachmentError(416, "ATTACHMENT_RANGE_INVALID", "Rango fuera del adjunto", { size });
	}
	return range.start === 0 && range.end === size - 1 ? undefined : range;
}

const FILE_NAME_SAFE = /[^A-Za-z0-9._-]+/g;

function safeFileName(name: string): string {
	const bounded = name.slice(0, 240);
	const cleaned = trimChar(bounded.replaceAll(FILE_NAME_SAFE, "_").replaceAll(/_+/g, "_"), "_");
	return cleaned.length > 0 ? cleaned.slice(0, 120) : "file";
}

function sanitizeSegment(seg: string): string {
	const bounded = seg.slice(0, 200);
	return trimChar(bounded.replaceAll(/[^A-Za-z0-9._-]+/g, "_"), "_") || "_";
}

export class AttachmentsManager {
	readonly #model: Model<AttachmentDoc>;
	readonly #resolveS3: () => S3Like;
	readonly #bucket: string;
	readonly #basePath: string;
	readonly #subPathResolver: (ctx: SubPathContext) => string;
	readonly #permissionChecker: AttachmentPermissionChecker;
	readonly #maxSize: number;
	readonly #allowedMimes: ReadonlySet<string> | null;
	readonly #presignTtl: number;
	readonly #quota?: AttachmentsQuotaOptions;
	readonly #limits: { maxConcurrent: number; bytesPerHour: number };
	readonly #rateModel: Model<UploadRateDoc> | null;
	readonly #onQuotaExceeded?: (userId: string, appId: string) => void;
	readonly #encryption?: { keyStore: UserKeyStore };
	readonly #logger?: { logWarn(msg: string): void };

	constructor(opts: AttachmentsManagerOptions) {
		this.#model = opts.model;
		this.#resolveS3 = typeof opts.s3Provider === "function" ? opts.s3Provider : () => opts.s3Provider as S3Like;
		this.#bucket = opts.bucket ?? this.#s3.getDefaultBucket();
		this.#basePath = sanitizeSegment(opts.basePath);
		this.#subPathResolver = opts.subPathResolver;
		this.#permissionChecker = opts.permissionChecker;
		this.#maxSize = opts.maxSize ?? ATTACHMENT_DEFAULT_MAX_SIZE;
		this.#allowedMimes = opts.allowedMimeTypes === null ? null : new Set(opts.allowedMimeTypes ?? ATTACHMENT_DEFAULT_ALLOWED_MIMES);
		this.#presignTtl = opts.presignTtl ?? this.#s3.getDefaultPresignTtl();
		this.#quota = opts.quota;
		this.#limits = {
			maxConcurrent: positiveOrZero(opts.uploadLimits?.maxConcurrent ?? settingNumber("UPLOAD_MAX_CONCURRENT"), DEFAULT_MAX_CONCURRENT_UPLOADS),
			bytesPerHour: positiveOrZero(opts.uploadLimits?.bytesPerHour ?? settingNumber("UPLOAD_BYTES_PER_HOUR"), DEFAULT_UPLOAD_BYTES_PER_HOUR),
		};
		// El contador cuelga de la MISMA conexión que los adjuntos: la utility no resuelve
		// dependencias por DI, así que sale del modelo que ya recibió.
		this.#rateModel =
			this.#limits.bytesPerHour > 0
				? getOrCreateUploadRateModel(this.#model.db as unknown as Connection, opts.uploadLimits?.rateCollectionName ?? DEFAULT_RATE_COLLECTION)
				: null;
		this.#onQuotaExceeded = opts.onQuotaExceeded;
		this.#encryption = opts.encryption;
		this.#logger = opts.logger;
		// El token de `@OnlyKernel` se guarda en el WeakMap del decorador (no como
		// propiedad legible por nombre `this.kernelKey`).
		bindKernelKey(this, opts.kernelKey);
	}

	/** Instancia vigente del provider de S3: se resuelve en cada uso, nunca se guarda (ver `S3Resolver`). */
	get #s3(): S3Like {
		return this.#resolveS3();
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
				this.#notifyQuotaExceeded(ctx.userId);
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

	/** Dispara el hook de "cuota alcanzada" (best-effort, nunca lanza). */
	#notifyQuotaExceeded(userId: string): void {
		if (!this.#onQuotaExceeded || !userId) return;
		try {
			this.#onQuotaExceeded(userId, this.#quota?.appId ?? "");
		} catch {
			/* best-effort: nunca rompe el flujo de subida */
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

	/**
	 * Cuántas subidas firmadas y sin confirmar tiene el sujeto **ahora mismo**.
	 *
	 * Se cuentan los `pending` más nuevos que la vigencia de la URL y no todos: un presign que nadie
	 * usó deja su fila hasta que pasa el recolector (24 h), y abandonar cinco subidas dejaría al
	 * usuario bloqueado un día entero por URLs que ya no sirven para subir nada.
	 *
	 * Se cuenta en vivo y no con un contador aparte: el documento `pending` ya existe, así que no hay
	 * dos verdades que puedan separarse.
	 */
	async #countInFlight(ctx: AttachmentPermissionContext): Promise<number> {
		const since = new Date(Date.now() - this.#presignTtl * 1000);
		return this.#model.countDocuments({
			uploadedBy: ctx.userId,
			orgId: ctx.orgId ?? null,
			status: "pending",
			createdAt: { $gt: since },
		});
	}

	/** Bytes ya subidos por el sujeto en la hora en curso. `0` si el tope está apagado. */
	async #bytesThisHour(ctx: AttachmentPermissionContext): Promise<number> {
		if (!this.#rateModel || !this.#quota) return 0;
		const id = rateBucketId(ctx.userId, ctx.orgId ?? null, this.#quota.appId, new Date());
		const doc = await this.#rateModel.findById(id).lean<UploadRateDoc>();
		return doc?.bytes ?? 0;
	}

	/**
	 * Suma bytes al balde de la hora. Corre **al confirmar**, con el tamaño real leído del
	 * almacenamiento: el que declara el cliente al pedir la firma no obliga a nada.
	 *
	 * Nunca lanza ni bloquea la subida que la disparó: el tope se aplica sobre la SIGUIENTE. Rechazar
	 * acá sería borrar un objeto que el usuario ya terminó de mandar, con el ancho de banda gastado.
	 */
	async #recordUploadedBytes(ctx: AttachmentPermissionContext, bytes: number): Promise<void> {
		if (!this.#rateModel || !this.#quota || bytes <= 0) return;
		const now = new Date();
		const id = rateBucketId(ctx.userId, ctx.orgId ?? null, this.#quota.appId, now);
		try {
			await this.#rateModel.updateOne(
				{ _id: id },
				// Dos horas y no una: con exactamente una, el barrido de Mongo podría llevárselo
				// mientras la hora en curso todavía lo está usando.
				{ $inc: { bytes }, $setOnInsert: { expiresAt: new Date(now.getTime() + 2 * 3_600_000) } },
				{ upsert: true }
			);
		} catch (e) {
			this.#logger?.logWarn(`Attachments(${this.#quota.appId}): no se pudo contabilizar el caudal de subida (${(e as Error).message})`);
		}
	}

	/**
	 * Los dos topes de caudal, comprobados antes de firmar.
	 *
	 * Van antes de firmar y no en la confirmación porque acá todavía no se gastó nada: negar una
	 * confirmación cuesta el ancho de banda de un archivo entero que además hay que borrar. El `429`
	 * lleva `retryAfterSeconds` para que el cliente espere en vez de reintentar en bucle.
	 */
	async #checkUploadRate(ctx: AttachmentPermissionContext): Promise<void> {
		if (this.#limits.maxConcurrent > 0) {
			const inFlight = await this.#countInFlight(ctx);
			if (inFlight >= this.#limits.maxConcurrent) {
				throw new AttachmentError(429, "ATTACHMENT_TOO_MANY_UPLOADS", `Ya tenés ${inFlight} subida(s) en curso: esperá a que terminen o cancelalas.`, {
					inFlight,
					maxConcurrent: this.#limits.maxConcurrent,
					retryAfterSeconds: this.#presignTtl,
				});
			}
		}
		if (this.#limits.bytesPerHour > 0) {
			const used = await this.#bytesThisHour(ctx);
			if (used >= this.#limits.bytesPerHour) {
				const retryAfterSeconds = Math.max(1, 3600 - Math.floor((Date.now() % 3_600_000) / 1000));
				throw new AttachmentError(429, "ATTACHMENT_UPLOAD_RATE_EXCEEDED", "Alcanzaste el máximo de subida por hora. Volvé a intentar más tarde.", {
					usedBytes: used,
					limitBytes: this.#limits.bytesPerHour,
					retryAfterSeconds,
				});
			}
		}
	}

	async presignUpload(ctx: AttachmentPermissionContext, input: PresignUploadInput): Promise<PresignUploadResult> {
		this.#validateUploadInput(input);
		const subCtx: SubPathContext = { ...ctx, ownerType: input.ownerType, ownerId: input.ownerId };
		await this.#checkPermission("upload", subCtx);
		await this.#checkQuotaAllowance(ctx, input.size);
		// Después de la cuota y antes de crear la fila: la fila `pending` es lo que cuenta como
		// «subida en curso», así que hacerlo después se contaría a sí misma.
		await this.#checkUploadRate(ctx);

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

		// La fila ya está creada: si el presign falla, se retira. Si no, cada fallo deja un
		// `pending` que nadie reclama —no hay objeto en S3 ni `confirmUpload` que lo cierre—.
		let presigned;
		try {
			presigned = await this.#s3.getPresignedUploadUrl({
				bucket: this.#bucket,
				key,
				contentType: input.mimeType,
				contentLength: input.size,
				ttl: this.#presignTtl,
				publicHost: input.publicHost,
			});
		} catch (error) {
			await this.#model.deleteOne({ _id: attachmentId }).catch(() => undefined);
			throw error;
		}

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
		// El caudal se contabiliza donde se suma la cuota y con el mismo número (el tamaño
		// verificado), pero no en `unretain`: recuperar un adjunto retenido es administración.
		if (committed) await this.#recordUploadedBytes(ctx, head.size);
		if (!committed) {
			try {
				await this.#s3.deleteObject({ bucket: attachment.bucket, key: attachment.storageKey });
			} catch {
				// el GC de pending limpiará el objeto si este delete falla
			}
			await this.#model.deleteOne({ _id: attachmentId });
			this.#notifyQuotaExceeded(ctx.userId);
			throw new AttachmentError(413, "ATTACHMENT_QUOTA_EXCEEDED", "Cuota de almacenamiento agotada");
		}

		// Cifrado en reposo: re-escribe el objeto cifrado con la DEK del uploader.
		// El PUT presignado llega en claro; esta ventana se cierra acá (y el GC de
		// pending limpia los huérfanos si el proceso muere en el medio).
		let encryptionSet: Record<string, unknown> = {};
		if (this.#encryption) {
			try {
				encryptionSet = await this.#encryptObject(attachment);
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
	 * Re-escribe el objeto en claro como ciphertext por chunks (`aes-256-gcm-chunked`, ver
	 * `crypto/chunked.ts`) bajo `<key>.enc` y borra el original. Devuelve el `$set` con storageKey +
	 * metadata de cifrado.
	 */
	async #encryptObject(attachment: Attachment): Promise<Record<string, unknown>> {
		const keyStore = this.#encryption!.keyStore;
		const dek = await keyStore.getUserKey(attachment.uploadedBy);
		const source = await this.#s3.getObjectStream({ bucket: attachment.bucket, key: attachment.storageKey });

		const plaintext = await streamToBuffer(source.stream);
		const { ivPrefix, ciphertext } = encryptChunked(dek, plaintext, ENCRYPTION_CHUNK_SIZE);
		const encryptedKey = `${attachment.storageKey}.enc`;
		try {
			await this.#s3.putObject({
				bucket: attachment.bucket,
				key: encryptedKey,
				body: ciphertext,
				contentType: "application/octet-stream",
				contentLength: ciphertext.length,
			});
		} catch (e) {
			await this.#s3.deleteObject({ bucket: attachment.bucket, key: encryptedKey }).catch(() => undefined);
			throw e;
		}
		await this.#s3.deleteObject({ bucket: attachment.bucket, key: attachment.storageKey }).catch(() => undefined);
		return {
			storageKey: encryptedKey,
			encryption: {
				scheme: CHUNKED_ENCRYPTION_SCHEME,
				iv: ivPrefix.toString("base64"),
				chunkSize: ENCRYPTION_CHUNK_SIZE,
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
		opts: { ttl?: number; inline?: boolean; publicHost?: string } = {}
	): Promise<{ url: string; attachment: Attachment; expiresIn: number }> {
		const attachment = await this.#getReadyForRead(ctx, attachmentId);
		if (attachment.encryption) {
			// Una URL presignada devolvería ciphertext: el consumer debe proxyear
			// la descarga con `openDownloadStream`.
			throw new AttachmentError(409, "ATTACHMENT_ENCRYPTED", "Adjunto cifrado: descargar vía streaming del servicio");
		}
		const ttl = opts.ttl ?? this.#presignTtl;
		// El `Content-Type` del upload presignado NO va firmado, así que lo guardado en S3 puede
		// no ser lo declarado acá. Se fuerzan las dos cosas en la URL (ambas firmadas):
		//  - `response-content-type` = el tipo declarado y validado contra la allowlist;
		//  - `inline` sólo para tipos que el navegador no ejecuta (un SVG sí ejecuta scripts).
		const inline = (opts.inline ?? false) && isInlineSafeMime(attachment.mimeType);
		const url = await this.#s3.getPresignedDownloadUrl({
			bucket: attachment.bucket,
			key: attachment.storageKey,
			ttl,
			filename: attachment.fileName,
			inline,
			contentType: attachment.mimeType || undefined,
			publicHost: opts.publicHost,
		});
		return { url, attachment, expiresIn: ttl };
	}

	/**
	 * Stream de descarga del binario (descifrado al vuelo si está cifrado).
	 * Mismo modelo de permisos que `getDownloadUrl`; pensado para que el servicio
	 * lo proxyee por HTTP con sus propios headers de disposición.
	 *
	 * `opts.range` (tramo del CLARO, extremos inclusive, ya validado contra
	 * `attachment.size` por el caller que responde el `206`) se honra siempre:
	 * - Sin cifrar: el rango lo corta S3 (`Range` en el GET).
	 * - `aes-256-gcm-chunked`: se piden a S3 sólo los chunks que cubren el tramo y
	 *   se descifran al vuelo (memoria acotada a un chunk, tag por chunk verificado).
	 * - `aes-256-gcm` (legado): el formato exige descifrar el objeto completo y recortar el tramo.
	 */
	async openDownloadStream(
		ctx: AttachmentPermissionContext,
		attachmentId: string,
		opts: { range?: PlainByteRange } = {}
	): Promise<{ stream: Readable; attachment: Attachment }> {
		const attachment = await this.#getReadyForRead(ctx, attachmentId);
		const range = normalizeDownloadRange(opts.range, attachment.size);
		const encryption = attachment.encryption;
		if (!encryption) {
			const object = await this.#s3.getObjectStream({ bucket: attachment.bucket, key: attachment.storageKey, range });
			return { stream: object.stream, attachment };
		}
		if (!this.#encryption) {
			throw new AttachmentError(409, "ATTACHMENT_ENCRYPTED", "Adjunto cifrado pero el manager no tiene keyStore configurado");
		}
		const dek = await this.#encryption.keyStore.getUserKey(encryption.keyRef);

		if (encryption.scheme === CHUNKED_ENCRYPTION_SCHEME) {
			const chunkSize = encryption.chunkSize ?? 0;
			if (chunkSize <= 0) {
				throw new AttachmentError(500, "ATTACHMENT_DECRYPT_FAILED", "Metadata de cifrado por chunks corrupta (chunkSize)");
			}
			const wanted = range ?? { start: 0, end: attachment.size - 1 };
			const object = await this.#s3.getObjectStream({
				bucket: attachment.bucket,
				key: attachment.storageKey,
				range: chunkedCipherRange(wanted, attachment.size, chunkSize),
			});
			// Iteración async (no `.pipe`): funciona igual con el Body del SDK sea Node
			// `Readable` o web stream, que en Bun varía según el camino.
			const source = object.stream as AsyncIterable<Uint8Array> & { destroy?: () => void };
			const plainSize = attachment.size;
			const ivPrefix = encryption.iv;
			async function* decrypted(): AsyncGenerator<Buffer> {
				try {
					yield* decryptChunkedRange(dek, ivPrefix, { plainSize, chunkSize, range: wanted }, source);
				} finally {
					// Si el consumidor corta antes (seek de video, pestaña cerrada), soltar la lectura de S3.
					source.destroy?.();
				}
			}
			return { stream: Readable.from(decrypted()), attachment };
		}

		// Esquema legado (GCM entero): descifrado bufferizado — el formato no admite lectura parcial
		// y el tamaño lo acota el límite de subida.
		const object = await this.#s3.getObjectStream({ bucket: attachment.bucket, key: attachment.storageKey });
		const decipher = createObjectDecipher(dek, encryption.iv, encryption.authTag ?? "");
		const ciphertext = await streamToBuffer(object.stream);
		let plaintext: Buffer;
		try {
			plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		} catch (e) {
			throw new AttachmentError(500, "ATTACHMENT_DECRYPT_FAILED", `No se pudo descifrar el adjunto: ${(e as Error).message}`);
		}
		const body = range ? plaintext.subarray(range.start, range.end + 1) : plaintext;
		// `[body]` (no `body`): un Buffer es iterable de bytes; envuelto en array se
		// emite como un único chunk Buffer en vez de números sueltos.
		return { stream: Readable.from([body]), attachment };
	}

	async #getReadyForRead(ctx: AttachmentPermissionContext, attachmentId: string): Promise<Attachment> {
		const attachment = await this.getById(ctx, attachmentId);
		if (!attachment) {
			throw new AttachmentError(404, "ATTACHMENT_NOT_FOUND", "Adjunto no encontrado");
		}
		// `retained` no es "todavía no": el adjunto existe y está completo, pero una
		// retención legal lo bloquea. 423 lo distingue del 409 de "sigue subiendo".
		if (attachment.status === "retained") {
			throw new AttachmentError(423, "ATTACHMENT_RETAINED", "Adjunto bloqueado por una retención legal");
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
		await this.#purge(attachmentId);
	}

	/** Purga real (objeto + documento + cuota si estaba activo), sin control de acceso. */
	async #purge(attachmentId: string): Promise<void> {
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
		await this.#model.updateOne({ _id: attachmentId }, { $set: { status: "retained", retainedAt: new Date() } });
		await this.#releaseQuota(doc.uploadedBy, doc.orgId ?? null, doc.size);
		await this.#trimRetainedPool({ userId: doc.uploadedBy, orgId: doc.orgId ?? null });
	}

	/**
	 * Mantiene acotado el pool de retención de un sujeto.
	 *
	 * Los bytes `retained` no cuentan cuota (el borrado tiene que liberar espacio de
	 * verdad) pero siguen ocupando disco durante toda la retención legal. Sin un tope,
	 * alcanza con rotar "subir y borrar" para almacenar un múltiplo del plan contratado
	 * sin pagarlo. El tope es el propio límite del sujeto: se puede tener retenido, como
	 * mucho, tanto como se puede tener activo. Al pasarse, se purgan de verdad los más
	 * viejos — que son los que menos chance tienen de recuperarse.
	 */
	async #trimRetainedPool(subject: { userId: string; orgId: string | null }): Promise<void> {
		if (!this.#quota) return;
		try {
			const tracker = this.#quota.getTracker();
			if (!tracker) return;
			const { effectiveLimit } = await tracker.checkAllowance(subject, this.#quota.appId, 0);
			if (effectiveLimit === UNLIMITED_BYTES || effectiveLimit <= 0) return;

			const retained = await this.#model
				.find({ uploadedBy: subject.userId, orgId: subject.orgId, status: "retained" })
				.sort({ retainedAt: 1, createdAt: 1 })
				.lean<Array<AttachmentDoc & { _id: string }>>();

			let total = retained.reduce((sum, d) => sum + d.size, 0);
			for (const d of retained) {
				if (total <= effectiveLimit) break;
				await this.#purge(d._id);
				total -= d.size;
			}
		} catch (e) {
			// Best-effort: no dejar de retener porque falló la poda.
			this.#logger?.logWarn(`Attachments(${this.#quota.appId}): poda del pool retenido falló (${(e as Error).message})`);
		}
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
		await this.#model.updateOne({ _id: attachmentId }, { $set: { status: "ready", retainedAt: null } });
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
	 * ⚠️ Blanquea el `uploadedBy` de todos los adjuntos de un usuario, sin tocar el objeto en S3.
	 * Es la contracara de {@link forceDeleteByOwner} para el contenido que **sobrevive** a la baja:
	 * cuando un artículo publicado se anonimiza en vez de borrarse, el `uploadedBy` de sus adjuntos
	 * seguía guardando el userId en claro, y un join por `ownerId` devolvía la autoría que la
	 * anonimización acababa de quitar. Misma convención que `CommentsManager.anonymizeByAuthor`:
	 * cadena vacía, irreversible. No libera cuota —el objeto sigue ocupando lugar—, pero deja de
	 * imputarse a nadie en {@link aggregateUsageByUser}. Para cascadas de confianza.
	 * Devuelve la cantidad de documentos modificados.
	 */
	@OnlyKernel()
	async anonymizeByUploader(_kernelKey: symbol, userId: string): Promise<number> {
		if (!userId) return 0;
		const res = await this.#model.updateMany({ uploadedBy: userId }, { $set: { uploadedBy: "" } });
		return res.modifiedCount ?? 0;
	}

	/**
	 * Uso real por (usuario, contexto) de los attachments `ready` de ESTA
	 * colección/app. Alimenta `computeUsage` del registro en StorageQuotaService
	 * (reconciliación). Protegido por `@OnlyKernel()`.
	 */
	@OnlyKernel()
	async aggregateUsageByUser(_kernelKey: symbol): Promise<Array<{ userId: string; orgId: string | null; bytes: number; count: number }>> {
		const rows = await this.#model.aggregate<{ _id: { u: string; o: string | null }; bytes: number; count: number }>([
			// `uploadedBy: ""` son adjuntos de cuentas dadas de baja (ver `anonymizeByUploader`): el
			// archivo sigue existiendo pero ya no se imputa a nadie, y agruparlo crearía un usuario fantasma.
			{ $match: { status: "ready", uploadedBy: { $ne: "" } } },
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
