import ADCCustomError from "../ADCCustomError.ts";

type ExpectedSubscriptionErrorTypes =
	// Access
	| "NOT_AUTHENTICATED"
	| "ORG_ACCESS_DENIED"
	| "FORBIDDEN"
	| "PLAN_NOT_FOUND"
	// Validation
	| "MISSING_FIELDS"
	| "INVALID_FIELD"
	| "PLAN_NOT_PURCHASABLE"
	| "SEATS_BELOW_MEMBERS"
	| "SEATS_OUT_OF_RANGE"
	| "COUNTRY_NOT_SUPPORTED"
	| "BILLING_DATA_REQUIRED";

type UnexpectedSubscriptionErrorTypes = "GATEWAY_UNAVAILABLE" | "GATEWAY_ERROR" | "PLANS_UNAVAILABLE";

type SubscriptionErrorTypes = ExpectedSubscriptionErrorTypes | UnexpectedSubscriptionErrorTypes;

export class SubscriptionError extends ADCCustomError<Record<string, unknown>, SubscriptionErrorTypes> {
	public readonly name = "SubscriptionError";
}
