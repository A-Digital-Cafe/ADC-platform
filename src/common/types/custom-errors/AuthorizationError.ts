import ADCCustomError from "../ADCCustomError.ts";

type AuthorizationErrorCode = "NO_TOKEN" | "INVALID_TOKEN" | "FORBIDDEN";

const AUTH_STATUS_MAP: Record<AuthorizationErrorCode, number> = {
	NO_TOKEN: 401,
	INVALID_TOKEN: 401,
	FORBIDDEN: 403,
};

export class AuthorizationError extends ADCCustomError<Record<string, unknown>, AuthorizationErrorCode> {
	public readonly name = "AuthorizationError";

	constructor(message: string, code: AuthorizationErrorCode = "FORBIDDEN") {
		super(AUTH_STATUS_MAP[code], code, message);
	}
}
