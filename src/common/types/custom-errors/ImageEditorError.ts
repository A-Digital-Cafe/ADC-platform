import ADCCustomError from "../ADCCustomError.ts";

type ExpectedImageEditorErrorTypes =
	// Access
	| "NOT_AUTHENTICATED"
	| "IMAGE_EDITOR_FORBIDDEN"
	// Validation
	| "MISSING_FIELDS"
	| "INVALID_FIELD"
	| "UNSUPPORTED_FORMAT"
	| "RESOLUTION_TOO_HIGH"
	// Quota / entitlements
	| "QUOTA_EXCEEDED"
	| "DAILY_QUOTA_EXCEEDED"
	// Jobs (IA)
	| "JOB_NOT_FOUND"
	| "JOB_FAILED";

type UnexpectedImageEditorErrorTypes = "IMAGE_EDITOR_UNAVAILABLE" | "INFERENCE_UNAVAILABLE";

type ImageEditorErrorTypes = ExpectedImageEditorErrorTypes | UnexpectedImageEditorErrorTypes;

export class ImageEditorError extends ADCCustomError<Record<string, unknown>, ImageEditorErrorTypes> {
	public readonly name = "ImageEditorError";
}
