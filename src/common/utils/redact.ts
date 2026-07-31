/**
 * Redacción de secretos y PII en texto libre.
 *
 * Pensado para el último punto antes de que un texto se guarde o se muestre a un
 * tercero (buffer de logs, respuestas de diagnóstico, tickets de error). La regla
 * es redactar AL ESCRIBIR, no al leer: un almacén con el texto crudo es un
 * almacén consultable de secretos, por más que la vista los tape.
 *
 * Es best-effort sobre patrones conocidos, no un DLP: sirve para que un secreto
 * no quede en un buffer/registro por descuido, no para habilitar loguear secretos.
 */

/** Marcador único: hace obvio en la lectura que ahí había algo y que se sacó. */
const MARK = "[REDACTED]";

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
	// Credenciales embebidas en URLs (amqp://, mongodb+srv://, redis://, http(s)://...): se
	// conservan esquema y host, se tira el par usuario:password.
	// El esquema se acota a 15 caracteres para que el greedy no vuelva la regla cuadrática, y el
	// usuario puede ser vacío: así arma el kernel la URL de Redis (`redis://:password@host`).
	[/([a-z][a-z0-9+.-]{0,15}:\/\/)[^\s/@:]*:[^\s/@]*@/gi, `$1${MARK}@`],
	// Authorization: Bearer <token>
	[/\bBearer\s+[\w.\-+/=]+/gi, `Bearer ${MARK}`],
	// JWT sueltos: el header base64url de `{"alg"...` siempre empieza con `eyJ`.
	[/\beyJ[\w-]*\.[\w-]+\.[\w-]*/g, MARK],
	// Asignaciones `clave=valor` (query strings, DSNs, dumps de env, líneas de log).
	// El prefijo acotado cubre las variantes compuestas (`DB_PASSWORD`, `mongoPass`, `x-api-key`)
	// y se preserva el separador original. Dos reglas chicas en vez de una alternancia gigante:
	// más legible y sin backtracking anidado.
	[/([\w.-]{0,40}(?:pass|pwd|secret)\w{0,10})(\s*[=:]\s*)(?:"[^"]*"|[^\s&,;)"]+)/gi, `$1$2${MARK}`],
	[/([\w.-]{0,40}(?:token|apikey|[_-]key))(\s*[=:]\s*)(?:"[^"]*"|[^\s&,;)"]+)/gi, `$1$2${MARK}`],
	// Códigos y tokens que viajan por query string (OAuth y compañía).
	[/([?&](?:code|state|refresh_token|id_token|access_token)=)[^\s&]+/gi, `$1${MARK}`],
	// Idempotency-Key: identifica la operación de un cliente concreto.
	[/\b(idempotency-key)(\s*[:=]\s*)[^\s,;]+/gi, `$1$2${MARK}`],
	// Emails (PII). Se exige TLD para no comerse cosas como `usuario@host`.
	[/\b[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi, MARK],
];

/** Direcciones sin valor identificatorio: redactarlas sólo ensucia los logs. */
const NON_IDENTIFYING_IPV4 = /^(?:0\.0\.0\.0|255\.255\.255\.255|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

/** Descarta falsos positivos tipo versión (`1.2.3.400`) validando los octetos. */
function isIpv4(candidate: string): boolean {
	return candidate.split(".").every((octet) => Number(octet) <= 255);
}

/**
 * Devuelve `text` con credenciales y PII conocidas reemplazadas por `[REDACTED]`.
 * Idempotente: aplicarla dos veces da el mismo resultado.
 */
export function redact(text: string): string {
	if (!text) return text;
	let out = text;
	for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
	return out.replace(IPV4, (match) => (isIpv4(match) && !NON_IDENTIFYING_IPV4.test(match) ? MARK : match));
}
