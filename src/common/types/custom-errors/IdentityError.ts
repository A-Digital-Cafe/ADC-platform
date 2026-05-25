import ADCCustomError, { type ADCCustomErrorJSON } from "../ADCCustomError.ts";

type IdentityErrorTypes =
	// Access / org isolation
	| "ORG_ACCESS_DENIED"
	| "GLOBAL_ONLY"
	| "CROSS_ORG_ROLE"
	| "CROSS_ORG_USER"
	| "CROSS_ORG_GROUP"
	| "CANNOT_MODIFY_PREDEFINED"
	| "CANNOT_DELETE_PREDEFINED"
	| "FORBIDDEN_FIELD"
	// Not found
	| "USER_NOT_FOUND"
	| "ROLE_NOT_FOUND"
	| "GROUP_NOT_FOUND"
	| "ORG_NOT_FOUND"
	| "REGION_NOT_FOUND"
	// Validation
	| "FORBIDDEN"
	| "INVALID_BODY"
	| "MISSING_FIELDS"
	| "MISSING_TARGET"
	| "INVALID_REASON"
	| "INVALID_ROLE"
	| "INVALID_ROLE_ID"
	| "INVALID_GROUP"
	| "INVALID_FIELD"
	| "INVALID_PERMISSION";

export class IdentityError extends ADCCustomError<Record<string, unknown>, IdentityErrorTypes> {
	public readonly name = "IdentityError";
}

/**
 * @public
 */
export type ADCIdentityErrorJSON = ADCCustomErrorJSON<Record<string, unknown>, IdentityErrorTypes>;
