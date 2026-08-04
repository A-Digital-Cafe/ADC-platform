import ADCCustomError from "../ADCCustomError.ts";

type ExpectedPlanErrorTypes =
	// Access
	| "GLOBAL_ONLY"
	| "ORG_ACCESS_DENIED"
	| "NOT_AUTHENTICATED"
	| "PLAN_NOT_FOUND"
	| "FEATURE_NOT_FOUND"
	| "OVERRIDE_NOT_FOUND"
	| "SUBJECT_NOT_FOUND"
	| "ORG_NOT_FOUND"
	// Validation
	| "MISSING_FIELDS"
	| "INVALID_FIELD"
	| "LIMIT_EXCEEDS_ORG"
	| "UNLIMITED_FORBIDDEN"
	// Límites de plan
	| "QUOTA_EXCEEDED"
	| "DAILY_QUOTA_EXCEEDED"
	| "TIER_LIMIT_REACHED"
	| "SEAT_LIMIT_REACHED";

type UnexpectedPlanErrorTypes = "PLANS_UNAVAILABLE";

type PlanErrorTypes = ExpectedPlanErrorTypes | UnexpectedPlanErrorTypes;

export class PlanError extends ADCCustomError<Record<string, unknown>, PlanErrorTypes> {
	public readonly name = "PlanError";
}
