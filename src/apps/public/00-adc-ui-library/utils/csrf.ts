import type { HttpMethod } from "./adc-fetch.js";

const CSRF_PATH = "/api/csrf-token";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const MUTATIVE_METHODS: ReadonlySet<HttpMethod> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const tokenCache = new Map<string, string>();
/** Orígenes locales donde el endpoint no existe (CSRF apagado en dev): no reintentar. */
const disabledOrigins = new Set<string>();
const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]"]);
/** Dedup de requests concurrentes: N mutaciones en paralelo comparten un solo GET. */
const inFlight = new Map<string, Promise<string | null>>();

function shouldAttachCsrf(method: HttpMethod, credentials?: RequestCredentials): boolean {
	return MUTATIVE_METHODS.has(method) && credentials !== "omit";
}

function getCsrfUrl(requestUrl: string): string {
	try {
		const url = new URL(requestUrl, globalThis.location?.origin || "http://localhost");
		return requestUrl.startsWith("http") ? `${url.origin}${CSRF_PATH}` : CSRF_PATH;
	} catch {
		return CSRF_PATH;
	}
}

/**
 * Sólo un host local (dev) se considera "CSRF apagado a propósito" ante un 404. En cualquier otro
 * origen un 404 puede ser un fallo transitorio (deploy a medias, proxy), y desactivar el header
 * degradaría la seguridad de forma permanente: ahí siempre se reintenta.
 */
function isLocalOrigin(csrfUrl: string): boolean {
	try {
		const { hostname } = new URL(csrfUrl, globalThis.location?.href || "http://localhost");
		return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost") || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
	} catch {
		return false;
	}
}

async function requestCsrfToken(csrfUrl: string, credentials: RequestCredentials): Promise<string | null> {
	try {
		const response = await fetch(csrfUrl, { method: "GET", credentials, headers: { Accept: "application/json" } });
		// 404 en dev = la plataforma corre con CSRF apagado; el endpoint no va a aparecer en esta sesión.
		if (response.status === 404 && isLocalOrigin(csrfUrl)) disabledOrigins.add(csrfUrl);
		if (!response.ok) return null;
		const data = (await response.json()) as { csrfToken?: string };
		if (!data.csrfToken) return null;
		tokenCache.set(csrfUrl, data.csrfToken);
		return data.csrfToken;
	} catch {
		return null;
	}
}

// Sin `signal`: el GET se comparte entre callers concurrentes, así que el abort de uno no puede
// cancelarlo. Es un request corto contra el propio origen.
function fetchCsrfToken(csrfUrl: string, credentials: RequestCredentials): Promise<string | null> {
	const cached = tokenCache.get(csrfUrl);
	if (cached) return Promise.resolve(cached);
	if (disabledOrigins.has(csrfUrl)) return Promise.resolve(null);

	const pending = inFlight.get(csrfUrl);
	if (pending) return pending;

	const promise = requestCsrfToken(csrfUrl, credentials).finally(() => inFlight.delete(csrfUrl));
	inFlight.set(csrfUrl, promise);
	return promise;
}

export async function appendCsrfHeader(
	method: HttpMethod,
	url: string,
	headers: HeadersInit | undefined,
	credentials: RequestCredentials
): Promise<Headers> {
	const nextHeaders = new Headers(headers);
	if (!shouldAttachCsrf(method, credentials) || nextHeaders.has(CSRF_HEADER_NAME)) return nextHeaders;

	const token = await fetchCsrfToken(getCsrfUrl(url), credentials);
	if (token) nextHeaders.set(CSRF_HEADER_NAME, token);
	return nextHeaders;
}
