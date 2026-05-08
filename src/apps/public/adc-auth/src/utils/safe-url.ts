import { getUrl } from "@common/utils/url-utils.js";

/** URL base del sitio principal según entorno (destino por defecto tras login/registro). */
export const DEFAULT_RETURN_URL = getUrl(3011, "community.adigitalcafe.com");

/** Hostnames permitidos para redirección (allow-list estricta). */
const ALLOWED_HOSTS = new Set<string>(["adigitalcafe.com"]);
const ALLOWED_HOST_SUFFIX = ".adigitalcafe.com";

/**
 * Sanitiza una URL de retorno proveniente de input no confiable (query param, prop, etc.)
 * devolviendo siempre un valor seguro:
 *   - path relativo que no escapa al origen actual
 *   - URL absoluta cuyo hostname coincida con la allow-list
 *   - en cualquier otro caso, `DEFAULT_RETURN_URL`
 *
 * Esta función debe invocarse **inline, justo antes** de cualquier sink de
 * redirección (location.href, window.open, pushState con URL externa, etc.)
 * para que los analizadores de taint (SonarQube) la reconozcan como sanitizer.
 */
export function sanitizeReturnUrl(raw: string | null | undefined): string {
	if (typeof raw !== "string" || raw.length === 0) return DEFAULT_RETURN_URL;

	// Path relativo: debe empezar con "/" y no con "//" (evita protocol-relative URLs).
	if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) {
		// Rechaza caracteres de control (incluye CR, LF, NUL, DEL) para evitar header/URL injection.
		for (let i = 0; i < raw.length; i++) {
			const code = raw.codePointAt(i);
			if (code && (code < 0x20 || code === 0x7f)) return DEFAULT_RETURN_URL;
		}
		return raw;
	}

	let parsed: URL;
	try {
		parsed = new URL(raw, globalThis.location?.origin);
	} catch {
		return DEFAULT_RETURN_URL;
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return DEFAULT_RETURN_URL;

	const host = parsed.hostname.toLowerCase();
	const currentHost = globalThis.location?.hostname?.toLowerCase() ?? "";

	const allowed = host === currentHost || ALLOWED_HOSTS.has(host) || host.endsWith(ALLOWED_HOST_SUFFIX);

	return allowed ? parsed.href : DEFAULT_RETURN_URL;
}
