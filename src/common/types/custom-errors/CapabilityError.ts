import ADCCustomError from "../ADCCustomError.ts";

type CapabilityErrorTypes =
	// Falta el scope requerido en la capability presentada
	| "MISSING_SCOPE"
	// El argumento no es una capability válida (o se intentó forjar)
	| "INVALID_CAPABILITY";

export class CapabilityError extends ADCCustomError<Record<string, unknown>, CapabilityErrorTypes> {
	public readonly name = "CapabilityError";
}
