/**
 * Helper para construir URLs absolutas al microfront `adc-error`.
 *
 * Dev:  http://localhost:3026/<page>
 * Prod: https://error.adigitalcafe.com/<page>
 *
 * Sólo se usa server-side (los redirects HTTP del backend).
 */

const IS_DEV = process.env.NODE_ENV !== "production";

/** Base por ambiente (dev/prod). */
const ERROR_APP_BASE = IS_DEV ? "http://localhost:3026" : "https://error.adigitalcafe.com";

export type ErrorPage = "/" | "/banned" | "/csrf" | "/oauth";

/** Construye URL absoluta a una página de error con query params sanitizados. */
export function buildErrorUrl(page: ErrorPage, params: Record<string, string | undefined | null> = {}): string {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v != null && v !== "") qs.set(k, v);
	}
	const search = qs.toString();
	const searchParam = search ? `?${search}` : "";
	return `${ERROR_APP_BASE}${page}${searchParam}`;
}
