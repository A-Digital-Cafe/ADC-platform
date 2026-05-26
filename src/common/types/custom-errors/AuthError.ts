import ADCCustomError, { type ADCCustomErrorJSON } from "../ADCCustomError.ts";
type AuthErrorData = { blockedUntil?: number; permanent?: boolean; requireRelogin?: boolean };

type AuthGenericErrors = "NO_SESSION" | "INVALID_SESSION" | "NO_REFRESH_TOKEN" | "INVALID_REFRESH_TOKEN" | "LOCATION_CHANGE" | "REFRESH_FAILED";

type ExcpectedAuthErrorTypes =
	// AUTH FLOW
	| "MISSING_CREDENTIALS"
	| "INVALID_CREDENTIALS"
	| "ACCOUNT_DISABLED"
	| "ACCOUNT_BANNED"
	| "ACCOUNT_BLOCKED"
	| "ACCOUNT_BLOCKED_TEMP"
	| "ACCOUNT_BLOCKED_PERMANENT"
	| "MISSING_FIELDS"
	| "INVALID_USERNAME"
	| "WEAK_PASSWORD"
	| "INVALID_PASSWORD"
	| "INVALID_EMAIL"
	| "USERNAME_EXISTS"
	| "EMAIL_EXISTS"
	| "NOT_ORG_MEMBER"
	| "USER_NOT_FOUND"
	// OAUTH LINK FLOW
	| "NO_PENDING_LINK"
	| "INVALID_PENDING_LINK"
	| "PASSWORD_REQUIRED"
	| "WRONG_PASSWORD";

type UnexpectedAuthErrorTypes =
	// AUTH FLOW
	| "REGISTER_ERROR"
	| "AUTH_UNAVAILABLE"
	| "SERVICE_UNAVAILABLE"
	| "IDENTITY_NOT_AVAILABLE"
	| "PROVIDER_NOT_SUPPORTED"
	| "PROVIDER_CONFIG_NOT_FOUND"
	| "AUTH_ERROR"
	| "FORBIDDEN"
	| "UNAUTHORIZED";

type AuthErrorTypes = UnexpectedAuthErrorTypes | ExcpectedAuthErrorTypes | AuthGenericErrors;

export class AuthError extends ADCCustomError<AuthErrorData, AuthErrorTypes> {
	public readonly name = "AuthError";
}

/**
 * @public
 */
export type ADCAuthErrorJSON = ADCCustomErrorJSON<AuthErrorData, AuthErrorTypes>;
