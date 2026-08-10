import ADCCustomError from "../ADCCustomError.ts";

type BreachErrorTypes =
	// Validation
	| "INVALID_INPUT"
	| "INVALID_CURSOR"
	| "NOT_FOUND"
	// La transición pedida no existe desde el estado actual
	| "INVALID_TRANSITION"
	// Falta el campo que la transición exige (motivo de la demora, fundamento de no notificar…)
	| "MISSING_RATIONALE"
	// No hay a quién avisar y tampoco se invocó una excepción del art. 34.3
	| "AUDIENCE_EMPTY"
	// Quedan personas de la audiencia sin aviso despachado: no se puede dar por avisada a la gente
	| "SUBJECTS_PENDING"
	// El subsistema de notificaciones no está disponible: el aviso no se puede dar por hecho
	| "NOTIFICATIONS_UNAVAILABLE"
	// Sin auditoría no se aplican las decisiones que una autoridad va a revisar (fail-closed)
	| "AUDIT_UNAVAILABLE"
	| "BREACH_UNAVAILABLE";

export class BreachError extends ADCCustomError<Record<string, unknown>, BreachErrorTypes> {
	public readonly name = "BreachError";
}
