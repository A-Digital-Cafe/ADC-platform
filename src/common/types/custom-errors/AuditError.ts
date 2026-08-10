import ADCCustomError from "../ADCCustomError.ts";

type AuditErrorTypes =
	// Validation
	| "INVALID_ENTRY"
	| "INVALID_CURSOR"
	// El servicio o su Mongo no están disponibles (503): las operaciones fail-closed abortan
	| "AUDIT_UNAVAILABLE"
	// El insert falló pese al pre-flight (500): la acción pudo ejecutarse sin rastro
	| "AUDIT_WRITE_FAILED";

export class AuditError extends ADCCustomError<Record<string, unknown>, AuditErrorTypes> {
	public readonly name = "AuditError";
}
