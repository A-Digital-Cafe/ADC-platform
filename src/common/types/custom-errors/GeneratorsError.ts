import ADCCustomError from "../ADCCustomError.ts";

type ExpectedGeneratorsErrorTypes =
	// Access
	| "NOT_AUTHENTICATED"
	// Validation
	| "MISSING_FIELDS"
	| "UNSUPPORTED_FORMAT"
	| "RESOLUTION_TOO_HIGH"
	| "TRANSPARENCY_NOT_ALLOWED"
	// Quota / entitlements
	| "QUOTA_EXCEEDED"
	| "DAILY_QUOTA_EXCEEDED";

type UnexpectedGeneratorsErrorTypes = "GENERATORS_UNAVAILABLE";

type GeneratorsErrorTypes = ExpectedGeneratorsErrorTypes | UnexpectedGeneratorsErrorTypes;

export class GeneratorsError extends ADCCustomError<Record<string, unknown>, GeneratorsErrorTypes> {
	public readonly name = "GeneratorsError";
}
