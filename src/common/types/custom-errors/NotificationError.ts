import ADCCustomError from "../ADCCustomError.ts";

type NotificationErrorTypes =
	// Validación
	| "MISSING_FIELDS"
	| "INVALID_FIELD"
	// Recursos: la bandeja no devuelve 404 — lo ausente responde 204 (ver docs/architecture/http-status.md)
	// Auth
	| "UNAUTHENTICATED"
	// Infra
	| "TRANSPORT_UNAVAILABLE";

export class NotificationError extends ADCCustomError<Record<string, unknown>, NotificationErrorTypes> {
	public readonly name = "NotificationError";
}
