import { getUrl } from "@common/utils/url-utils.js";

/** URL base del sitio principal según entorno (destino por defecto tras login/registro). */
export const DEFAULT_RETURN_URL = getUrl(3011, "community.adigitalcafe.com");

/** Hostnames permitidos para redirección (allow-list estricta). */
const ALLOWED_HOSTS = new Set<string>(["adigitalcafe.com"]);
const ALLOWED_HOST_SUFFIX = ".adigitalcafe.com";
const SAFE_PROTOCOLS = new Set<string>(["http:", "https:"]);

function hasControlChars(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.codePointAt(i);
		if (code && (code < 0x20 || code === 0x7f)) return true;
	}

	return false;
}

function isSafeRelativePath(value: string): boolean {
	return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") && !hasControlChars(value);
}

function parseReturnUrl(value: string): URL | null {
	try {
		return new URL(value, globalThis.location?.origin);
	} catch {
		return null;
	}
}

function isAllowedHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	const currentHost = globalThis.location?.hostname?.toLowerCase() ?? "";

	return host === currentHost || ALLOWED_HOSTS.has(host) || host.endsWith(ALLOWED_HOST_SUFFIX);
}

/**
 * Sanitiza una URL de retorno proveniente de input no confiable (query param, prop, etc.)
 * devolviendo siempre un valor seguro:
 *   - path relativo que no escapa al origen actual
 *   - URL absoluta cuyo hostname coincida con la allow-list
 *   - en cualquier otro caso, `DEFAULT_RETURN_URL`
 */
export function sanitizeReturnUrl(raw: string | null | undefined): string {
	if (typeof raw !== "string" || raw.length === 0) return DEFAULT_RETURN_URL;
	if (hasControlChars(raw)) return DEFAULT_RETURN_URL;

	// Path relativo: debe empezar con "/" y no con "//" (evita protocol-relative URLs).
	if (isSafeRelativePath(raw)) {
		return raw;
	}

	const parsed = parseReturnUrl(raw);
	if (!parsed || !SAFE_PROTOCOLS.has(parsed.protocol)) return DEFAULT_RETURN_URL;

	return isAllowedHost(parsed.hostname) ? parsed.href : DEFAULT_RETURN_URL;
}

/**
 * Redirige solo hacia destinos ya normalizados y permitidos por la allow-list.
 * Mantiene la validación junto al sink para evitar open redirects en cambios futuros.
 */
export function redirectToReturnUrl(raw: string | null | undefined): void {
	const redirectUrl = sanitizeReturnUrl(raw);

	if (isSafeRelativePath(redirectUrl)) {
		globalThis.location.href = redirectUrl;
		return;
	}

	const parsed = parseReturnUrl(redirectUrl);
	if (parsed && SAFE_PROTOCOLS.has(parsed.protocol) && isAllowedHost(parsed.hostname)) {
		globalThis.location.href = parsed.href;
		return;
	}

	globalThis.location.href = DEFAULT_RETURN_URL;
}
