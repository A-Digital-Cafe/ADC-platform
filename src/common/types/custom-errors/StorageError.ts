import ADCCustomError from "../ADCCustomError.ts";

type ExpectedStorageErrorTypes =
	// Access
	| "GLOBAL_ONLY"
	| "ORG_ACCESS_DENIED"
	| "NOT_AUTHENTICATED"
	// Not found
	| "OVERRIDE_NOT_FOUND"
	| "SUBJECT_NOT_FOUND"
	| "ORG_NOT_FOUND"
	// Validation
	| "MISSING_FIELDS"
	| "INVALID_FIELD"
	| "LIMIT_EXCEEDS_ORG"
	| "UNLIMITED_FORBIDDEN"
	// Quota
	| "QUOTA_EXCEEDED";

type UnexpectedStorageErrorTypes = "QUOTA_UNAVAILABLE";

type StorageErrorTypes = ExpectedStorageErrorTypes | UnexpectedStorageErrorTypes;

export class StorageError extends ADCCustomError<Record<string, unknown>, StorageErrorTypes> {
	public readonly name = "StorageError";
}
