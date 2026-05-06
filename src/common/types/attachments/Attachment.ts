/**
 * Tipo común de Attachment compartido entre servicios (project-manager, content-service).
 * Almacenado en colección dedicada por servicio (`pm_attachments`, `article_attachments`),
 * con archivos en `internal-s3-provider` (minIO/S3).
 */

export type AttachmentStatus = "pending" | "ready";

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
	uploadedBy: string;
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

/** Compatibilidad con código previo. */
export type IssueAttachment = AttachmentDTO;

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
