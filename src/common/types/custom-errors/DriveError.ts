import ADCCustomError from "../ADCCustomError.ts";

type ExpectedDriveErrorTypes =
	// Access
	| "NOT_AUTHENTICATED"
	| "DRIVE_FORBIDDEN"
	| "SHARE_NOT_ALLOWED"
	// Not found
	| "FOLDER_NOT_FOUND"
	| "FILE_NOT_FOUND"
	| "SHARE_NOT_FOUND"
	| "LINK_NOT_FOUND"
	// Validation
	| "MISSING_FIELDS"
	| "INVALID_FIELD"
	| "NAME_TAKEN"
	| "FOLDER_CYCLE"
	| "FOLDER_TOO_DEEP"
	| "NOT_IN_TRASH"
	| "ALREADY_IN_TRASH"
	| "NO_PENDING_REVISION"
	| "LINK_EXPIRED"
	// PIN de carpetas
	| "PIN_REQUIRED"
	| "PIN_INVALID"
	// Accesos directos
	| "SHORTCUT_INVALID"
	| "SHORTCUT_TARGET_NOT_FOUND"
	| "NOT_DOWNLOADABLE"
	// Archivos comprimidos (descarga múltiple)
	| "ARCHIVE_NOT_FOUND"
	| "ARCHIVE_EMPTY"
	| "ARCHIVE_TOO_LARGE";

type UnexpectedDriveErrorTypes = "DRIVE_UNAVAILABLE";

type DriveErrorTypes = ExpectedDriveErrorTypes | UnexpectedDriveErrorTypes;

export class DriveError extends ADCCustomError<Record<string, unknown>, DriveErrorTypes> {
	public readonly name = "DriveError";
}
