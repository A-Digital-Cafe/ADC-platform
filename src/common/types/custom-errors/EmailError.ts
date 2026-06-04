import ADCCustomError from "../ADCCustomError.ts";

type EmailErrorTypes =
	// Validación
	| "MISSING_FIELDS"
	| "INVALID_FIELD"
	| "INVALID_ADDRESS"
	| "INVALID_RECIPIENTS"
	| "INVALID_SCHEDULE"
	// Recursos
	| "MESSAGE_NOT_FOUND"
	| "ACCOUNT_NOT_FOUND"
	| "ATTACHMENT_NOT_FOUND"
	| "FOLDER_NOT_FOUND"
	// Tier / cuota
	| "QUOTA_EXCEEDED"
	| "STORAGE_FULL"
	| "ATTACHMENT_TOO_LARGE"
	| "TOO_MANY_RECIPIENTS"
	| "TOO_MANY_SCHEDULED"
	// Auth
	| "INVALID_WEBHOOK_SECRET"
	// Infra
	| "TRANSPORT_UNAVAILABLE"
	| "ATTACHMENTS_UNAVAILABLE";

export class EmailError extends ADCCustomError<Record<string, unknown>, EmailErrorTypes> {
	public readonly name = "EmailError";
}
