import ADCCustomError from "../ADCCustomError.ts";

type LegalErrorTypes =
	| "INVALID_INPUT"
	| "UNKNOWN_DOCUMENT"
	// Regenerar un PDF congelado destruye una prueba: sin motivo asentado no se hace
	| "MISSING_REASON"
	// El generador de PDF corre como proceso aparte (importa React); no se lo encontró o falló
	| "PDF_BUILD_FAILED"
	// Sin auditoría no se ejecuta una acción destructiva sobre un documento publicado (fail-closed)
	| "AUDIT_UNAVAILABLE"
	// El aviso no salió: sin subsistema de notificaciones no se puede dar por comunicado
	| "ANNOUNCE_DROPPED"
	| "LEGAL_UNAVAILABLE";

export class LegalError extends ADCCustomError<Record<string, unknown>, LegalErrorTypes> {
	public readonly name = "LegalError";
}
