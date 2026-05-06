import ADCCustomError from "../ADCCustomError.ts";

type ProjectManagerErrorTypes =
	// Access
	| "ORG_ACCESS_DENIED"
	| "PROJECT_ACCESS_DENIED"
	| "FORBIDDEN_FIELD"
	// Not found
	| "PROJECT_NOT_FOUND"
	| "ISSUE_NOT_FOUND"
	| "SPRINT_NOT_FOUND"
	| "MILESTONE_NOT_FOUND"
	| "COLUMN_NOT_FOUND"
	| "LINK_TYPE_NOT_FOUND"
	| "CUSTOM_FIELD_NOT_FOUND"
	// Validation
	| "MISSING_FIELDS"
	| "INVALID_FIELD"
	| "SLUG_TAKEN"
	| "INVALID_SLUG"
	| "INVALID_COLUMN"
	| "INVALID_PRIORITY"
	| "WIP_LIMIT_REACHED"
	| "INVALID_VISIBILITY"
	// Tier / quota
	| "TIER_LIMIT_REACHED"
	// Feature flags
	| "ATTACHMENTS_NOT_IMPLEMENTED"
	// Comments
	| "COMMENT_REQUIRED_ON_FINAL"
	| "COMMENTS_UNAVAILABLE"
	| "ATTACHMENTS_UNAVAILABLE"
	// Auth
	| "NO_TOKEN";

export class ProjectManagerError extends ADCCustomError<Record<string, unknown>, ProjectManagerErrorTypes> {
	public readonly name = "ProjectManagerError";
}
