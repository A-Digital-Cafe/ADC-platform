/**
 * Tipo común de Attachment compartido entre servicios (project-manager, content-service).
 * Almacenado en colección dedicada por servicio (`pm_attachments`, `article_attachments`),
 * con archivos en `internal-s3-provider` (minIO/S3).
 */

/**
 * `pending`  — presignado, sin confirmar (no cuenta cuota).
 * `ready`    — confirmado y disponible (cuenta cuota).
 * `retained` — retenido por retención legal: el binario sigue en S3 pero NO cuenta
 *              cuota ni es descargable. Vuelve a `ready` al recuperarse.
 */
export type AttachmentStatus = "pending" | "ready" | "retained";

/**
 * Metadata de cifrado en reposo del objeto S3 (envelope encryption por usuario).
 * El binario en S3 es ciphertext AES-256-GCM; la DEK del usuario vive envuelta
 * por la master key de la plataforma. `size` sigue siendo el tamaño en claro
 * (GCM no expande; el auth tag se guarda aquí, no en el objeto).
 */
export interface AttachmentEncryption {
	scheme: "aes-256-gcm";
	/** IV por objeto (base64, 12 bytes). */
	iv: string;
	/** Auth tag GCM (base64, 16 bytes). */
	authTag: string;
	/** userId dueño de la DEK con la que se cifró. */
	keyRef: string;
}

export interface Attachment {
	id: string;
	/** `basePath` constante por servicio (ej. "projects", "articles"). */
	basePath: string;
	/** Subruta variable resuelta por el servicio (ej. "<projectId>/<issueId>", "<slug>"). */
	subPath: string;
	/** Tipo del recurso dueño ("issue", "article", "comment", etc.). */
	ownerType: string;
	/** Id del recurso dueño. Para drafts/comentarios libres puede ser un placeholder. */
	ownerId: string;
	fileName: string;
	mimeType: string;
	size: number;
	bucket: string;
	storageKey: string;
	etag?: string | null;
	status: AttachmentStatus;
	/** Presente cuando el objeto en S3 está cifrado en reposo. */
	encryption?: AttachmentEncryption | null;
	uploadedBy: string;
	/** Contexto de la subida (del token): null = personal, string = organización. Define dónde cuenta la cuota. */
	orgId: string | null;
	createdAt: Date;
	uploadedAt?: Date;
}

/**
 * Vista pública (cliente). No expone `bucket` ni `storageKey`; el front pide URLs vía endpoint.
 */
export interface AttachmentDTO {
	id: string;
	fileName: string;
	mimeType: string;
	size: number;
	status: AttachmentStatus;
	uploadedBy: string;
	uploadedAt?: string;
	createdAt: string;
}

export const ATTACHMENT_DEFAULT_MAX_SIZE = 25 * 1024 * 1024; // 25 MB

export const ATTACHMENT_DEFAULT_ALLOWED_MIMES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/svg+xml",
	"application/pdf",
	"application/zip",
	"application/json",
	"text/plain",
	"text/csv",
	"text/markdown",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
