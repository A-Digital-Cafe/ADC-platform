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

/** Colores de etiqueta soportados (alineados con `adc-badge`). */
export type DriveLabelColor = "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "indigo" | "purple" | "pink";

export const DRIVE_LABEL_COLORS: readonly DriveLabelColor[] = [
	"gray",
	"red",
	"orange",
	"yellow",
	"green",
	"teal",
	"blue",
	"indigo",
	"purple",
	"pink",
];

/** Etiqueta visual de una carpeta (estilo badges de project-management). */
export interface DriveLabel {
	name: string;
	color: DriveLabelColor;
}

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
	/** Etiquetas visuales (máx. DRIVE_MAX_LABELS). */
	labels?: DriveLabel[];
	/**
	 * Hash scrypt del PIN de la carpeta (null = sin PIN). Una carpeta con PIN
	 * exige el PIN para crear enlaces públicos sobre ella o su contenido.
	 */
	pinHash?: string | null;
	trashedAt?: Date | null;
	/** parentId al momento de ir a papelera (para restaurar). */
	trashedFromParentId?: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/** Destino de un acceso directo: otro archivo del Drive o una URL web. */
export interface DriveShortcutTarget {
	type: "file" | "url";
	/** Id del archivo destino (type "file"). */
	fileId?: string | null;
	/** URL http(s) destino (type "url"). */
	url?: string | null;
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
	/** Presente solo en accesos directos (mimeType = DRIVE_SHORTCUT_MIME). */
	shortcut?: DriveShortcutTarget | null;
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
	labels?: DriveLabel[];
	/** True si la carpeta tiene PIN (el hash nunca sale del backend). */
	hasPin?: boolean;
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
	shortcut?: DriveShortcutTarget | null;
	status: DriveFileStatus;
	trashedAt?: string | null;
	createdAt: string;
	updatedAt: string;
}

// ── Búsqueda ────────────────────────────────────────────────────────────────

/** Categoría de tipo para el buscador (carpeta, mime agrupado o acceso directo). */
export type DriveSearchType = "folder" | "image" | "video" | "audio" | "document" | "text" | "shortcut" | "other";

export interface DriveSearchQuery {
	/** Texto a buscar en el nombre (case-insensitive). */
	q?: string;
	type?: DriveSearchType;
	/** Nombre de etiqueta (solo matchea carpetas). */
	label?: string;
	/** userId o username del autor (útil en recursos compartidos). */
	author?: string;
	/** ISO date: actualizado desde. */
	from?: string;
	/** ISO date: actualizado hasta. */
	to?: string;
}

export interface DriveSearchResults {
	folders: DriveFolderDTO[];
	files: DriveFileDTO[];
}

// ── Archivos comprimidos (descarga múltiple) ───────────────────────────────

/** Resultado del job de compresión: listo para auto-descargar. */
export interface DriveArchiveDTO {
	id: string;
	name: string;
	/** Tamaño del zip en bytes. */
	size: number;
	fileCount: number;
	/** Cantidad de seleccionados omitidos (accesos directos / no disponibles). */
	skipped: number;
	/** URL de descarga (relativa a la plataforma). */
	downloadUrl: string;
	expiresAt: string;
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

/** Mime sintético de los accesos directos (no tienen binario en S3). */
export const DRIVE_SHORTCUT_MIME = "application/x-adc-shortcut";
export const DRIVE_SHORTCUT_URL_MAX_LENGTH = 2048;

export const DRIVE_MAX_LABELS = 5;
export const DRIVE_LABEL_NAME_MAX_LENGTH = 24;

export const DRIVE_PIN_MIN_LENGTH = 4;
export const DRIVE_PIN_MAX_LENGTH = 12;

/** Límites de la descarga comprimida (zip temporal). */
export const DRIVE_ARCHIVE_MAX_FILES = 200;
export const DRIVE_ARCHIVE_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const DRIVE_ARCHIVE_TTL_MS = 60 * 60 * 1000; // 1 h
