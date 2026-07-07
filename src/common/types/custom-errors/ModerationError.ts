import ADCCustomError, { type ADCCustomErrorJSON } from "../ADCCustomError.ts";

type ModerationErrorTypes =
	// Validation
	| "MISSING_TARGET"
	| "INVALID_REASON"
	// Not found
	| "USER_NOT_FOUND"
	// Access
	| "FORBIDDEN";

export class ModerationError extends ADCCustomError<Record<string, unknown>, ModerationErrorTypes> {
	public readonly name = "ModerationError";
}

/**
 * @public
 */
export type ADCModerationErrorJSON = ADCCustomErrorJSON<Record<string, unknown>, ModerationErrorTypes>;
