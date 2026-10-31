import ADCCustomError from "../ADCCustomError.ts";

/**
 * Errores del gateway hacia Sumi. Los que Sumi devuelve (ProblemDetail con `error`) se reenvían
 * como `SUMI_<error>` con el mismo status, así la UI los traduce bajo `errors.SUMI_*`.
 * @public Lo usa el preset `sumi` (gateway).
 */
type SumiErrorTypes =
	"SUMI_UNAVAILABLE" | "SUMI_TIMEOUT" | "SUMI_GLOBAL_ONLY" | "SUMI_PATH_NOT_ALLOWED" | "SUMI_UPSTREAM_ERROR" | `SUMI_${string}`;

export class SumiError extends ADCCustomError<Record<string, unknown>, SumiErrorTypes> {
	public readonly name = "SumiError";
}
