import type { HttpMethod } from "./adc-fetch.js";

const CSRF_PATH = "/api/csrf-token";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const MUTATIVE_METHODS: ReadonlySet<HttpMethod> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const tokenCache = new Map<string, string>();

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

async function fetchCsrfToken(csrfUrl: string, credentials: RequestCredentials, signal?: AbortSignal): Promise<string | null> {
	const cached = tokenCache.get(csrfUrl);
	if (cached) return cached;

	try {
		const response = await fetch(csrfUrl, { method: "GET", credentials, headers: { Accept: "application/json" }, signal });
		if (!response.ok) return null;
		const data = (await response.json()) as { csrfToken?: string };
		if (!data.csrfToken) return null;
		tokenCache.set(csrfUrl, data.csrfToken);
		return data.csrfToken;
	} catch {
		return null;
	}
}

export async function appendCsrfHeader(
	method: HttpMethod,
	url: string,
	headers: HeadersInit | undefined,
	credentials: RequestCredentials,
	signal?: AbortSignal
): Promise<Headers> {
	const nextHeaders = new Headers(headers);
	if (!shouldAttachCsrf(method, credentials) || nextHeaders.has(CSRF_HEADER_NAME)) return nextHeaders;

	const token = await fetchCsrfToken(getCsrfUrl(url), credentials, signal);
	if (token) nextHeaders.set(CSRF_HEADER_NAME, token);
	return nextHeaders;
}

export function clearCsrfTokenCache(): void {
	tokenCache.clear();
}
