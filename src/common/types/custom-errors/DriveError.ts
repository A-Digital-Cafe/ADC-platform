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
	| "LINK_EXPIRED";

type UnexpectedDriveErrorTypes = "DRIVE_UNAVAILABLE";

type DriveErrorTypes = ExpectedDriveErrorTypes | UnexpectedDriveErrorTypes;

export class DriveError extends ADCCustomError<Record<string, unknown>, DriveErrorTypes> {
	public readonly name = "DriveError";
}
