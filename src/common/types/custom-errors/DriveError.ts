import ADCCustomError from "../ADCCustomError.ts";

type ExpectedDriveErrorTypes =
	// Access
	| "NOT_AUTHENTICATED"
	| "DRIVE_FORBIDDEN"
	| "SHARE_NOT_ALLOWED"
	| "ORG_ACCESS_DENIED"
	| "FOLDER_NOT_FOUND"
	| "FILE_NOT_FOUND"
	| "SHARE_NOT_FOUND"
	| "LINK_NOT_FOUND"
	| "ARCHIVE_NOT_FOUND"
	| "USER_NOT_FOUND"
	// Validation
	| "MISSING_FIELDS"
	| "INVALID_FIELD"
	| "NAME_TAKEN"
	| "FOLDER_CYCLE"
	| "FOLDER_TOO_DEEP"
	| "NOT_IN_TRASH"
	| "ALREADY_IN_TRASH"
	// Tamaño por archivo del plan (413; distinto de STORAGE_FULL, que es la cuota total)
	| "FILE_TOO_LARGE"
	| "NO_PENDING_REVISION"
	| "LINK_EXPIRED"
	// El enlace existe pero no se puede servir ahora (cupo del dueño agotado)
	| "LINK_UNAVAILABLE"
	// PIN de carpetas
	| "PIN_REQUIRED"
	| "PIN_INVALID"
	// Accesos directos
	| "SHORTCUT_INVALID"
	| "SHORTCUT_TARGET_NOT_FOUND"
	| "NOT_DOWNLOADABLE"
	// Archivos comprimidos (descarga múltiple)
	| "ARCHIVE_EXPIRED"
	| "ARCHIVE_EMPTY"
	| "ARCHIVE_TOO_LARGE"
	// Túnel entre dispositivos
	| "DEVICE_NOT_FOUND"
	| "DEVICE_LIMIT"
	| "DEVICE_OFFLINE"
	| "PAIRING_INVALID"
	| "MOUNT_UNAVAILABLE"
	| "TUNNEL_RPC_TIMEOUT"
	| "TUNNEL_RPC_FAILED"
	| "TRANSFER_NOT_FOUND"
	| "TRANSFER_EXPIRED"
	| "TRANSFER_LIMIT"
	| "DELIVERY_NOT_FOUND"
	| "NOT_TRANSFER_FOLDER"
	| "REMOTE_UNIT_NOT_FOUND"
	| "REMOTE_UNIT_LIMIT"
	// Cupo mensual de descarga
	| "EGRESS_QUOTA_EXCEEDED"
	// Cupo mensual del túnel entre dispositivos (pool aparte del de descarga)
	| "TUNNEL_QUOTA_EXCEEDED";

type UnexpectedDriveErrorTypes = "DRIVE_UNAVAILABLE";

type DriveErrorTypes = ExpectedDriveErrorTypes | UnexpectedDriveErrorTypes;

export class DriveError extends ADCCustomError<Record<string, unknown>, DriveErrorTypes> {
	public readonly name = "DriveError";
}
