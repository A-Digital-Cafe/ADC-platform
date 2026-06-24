import ADCCustomError from "../ADCCustomError.ts";

type NotificationErrorTypes =
	// Validación
	| "MISSING_FIELDS"
	| "INVALID_FIELD"
	// Recursos
	| "NOTIFICATION_NOT_FOUND"
	// Auth
	| "UNAUTHENTICATED"
	// Infra
	| "TRANSPORT_UNAVAILABLE";

export class NotificationError extends ADCCustomError<Record<string, unknown>, NotificationErrorTypes> {
	public readonly name = "NotificationError";
}
