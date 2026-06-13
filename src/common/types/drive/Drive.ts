/**
 * Tipos de dominio del Drive (preset adc-drive). Los binarios viven en S3 vía
 * attachments-utility; estas entidades modelan el árbol de carpetas, los
 * archivos y la compartición.
 *
 * Papelera: `trashedAt` se setea SOLO en la raíz de la operación (carpeta o
 * archivo); los descendientes quedan implícitamente en papelera porque la
 * navegación nunca los alcanza. Restaurar/vaciar opera sobre esas raíces.
 */

export type DriveFileStatus = "pending" | "ready";

export interface DriveFolder {
	id: string;
	name: string;
	/** null = raíz de la unidad del usuario. */
	parentId: string | null;
	ownerId: string;
	/** Contexto de organización de la unidad; null = unidad personal. */
	orgId: string | null;
	/**
	 * Ruta materializada de IDs de ancestros con separadores: raíz = "/",
	 * hijo de A (en raíz) = "/A/". Permite chequear ciclos y borrar subárboles.
	 */
	path: string;
	trashedAt?: Date | null;
	/** parentId al momento de ir a papelera (para restaurar). */
	trashedFromParentId?: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface DriveFile {
	id: string;
	name: string;
	/** null = raíz de la unidad. */
	folderId: string | null;
	ownerId: string;
	orgId: string | null;
	attachmentId: string;
	/** Attachment presignado de una revisión de contenido aún no confirmada. */
	pendingAttachmentId?: string | null;
	size: number;
	mimeType: string;
	/** `pending` hasta confirmar la subida a S3. */
	status: DriveFileStatus;
	trashedAt?: Date | null;
	trashedFromFolderId?: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export type DriveResourceType = "file" | "folder";
export type DriveGranteeType = "user" | "org" | "link";

export interface DriveShare {
	id: string;
	resourceType: DriveResourceType;
	resourceId: string;
	granteeType: DriveGranteeType;
	/** userId u orgId; null para enlaces públicos. */
	granteeId: string | null;
	/** Token aleatorio (256 bits, base64url); solo para `granteeType: "link"`. */
	token: string | null;
	permission: "read";
	grantedBy: string;
	expiresAt: Date | null;
	createdAt: Date;
}

// ── DTOs públicos (frontend) ───────────────────────────────────────────────

export interface DriveFolderDTO {
	id: string;
	name: string;
	parentId: string | null;
	/** Dueño del recurso (autor); útil para la vista de propiedades. */
	ownerId: string;
	trashedAt?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface DriveFileDTO {
	id: string;
	name: string;
	folderId: string | null;
	/** Dueño del recurso (autor); útil para la vista de propiedades. */
	ownerId: string;
	size: number;
	mimeType: string;
	status: DriveFileStatus;
	trashedAt?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface DriveShareDTO {
	id: string;
	resourceType: DriveResourceType;
	resourceId: string;
	granteeType: DriveGranteeType;
	granteeId: string | null;
	/** Solo presente al crear un enlace público. */
	token?: string | null;
	expiresAt: string | null;
	createdAt: string;
}

/** Límites operativos del Drive. */
export const DRIVE_MAX_FILE_SIZE = 512 * 1024 * 1024; // 512 MB por archivo
export const DRIVE_MAX_FOLDER_DEPTH = 20;
export const DRIVE_NAME_MAX_LENGTH = 200;
