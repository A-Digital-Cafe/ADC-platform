/**
 * ADC Fetch - Error-handling wrapper and API factory for frontend calls
 *
 * Features:
 * - Automatic error handling with adc-custom-error components
 * - API factory with configurable base URL and credentials
 * - Built-in dev/prod URL resolution
 * - Type-safe request/response handling
 */

import { showError } from "./error-handler.js";
import { forceLogoutAndRefresh } from "./auth-sync.js";
import { appendCsrfHeader } from "./csrf.js";
import ADCCustomError, { HttpError } from "@common/types/ADCCustomError.js";
import { IS_DEV, getDevUrl } from "@common/utils/url-utils.js";

export { clearErrors } from "./error-handler.js";

export interface AdcFetchResult<T = undefined> {
	success: boolean;
	data?: T;
	errorKey?: string;
	/** HTTP status code (undefined on network errors) */
	status?: number;
}

export interface AdcApiConfig {
	basePath: string;
	/**
	 * Dev server port - used when NODE_ENV === "development"
	 * If not provided, uses same origin in both dev and prod
	 */
	devPort?: number;
	/**
	 * Credentials mode for fetch requests
	 * @default "same-origin" (safer than "include" for same-domain requests)
	 */
	credentials?: RequestCredentials;
	headers?: HeadersInit;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

const MUTATIVE_METHODS: ReadonlySet<HttpMethod> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CIRCUIT_BREAKER_THRESHOLD = 5;

let failingBurstSecond = -1;
let failingBurstCount = 0;
let circuitBreakerTriggeredSecond = -1;

/**
 * Deterministic hash for idempotency keys.
 * Produces the same key for the same data, enabling safe retries.
 */
function hashIdempotency(data: unknown): string {
	const str = JSON.stringify(data);
	let h = 5381;
	for (const ch of str) h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0;
	return h.toString(36);
}

/**
 * Garantiza que el header `Idempotency-Key` solo contenga caracteres ISO-8859-1
 * imprimibles (HTTP no acepta unicode en headers). Si detecta caracteres fuera
 * de rango (e.g. emojis), reemplaza la clave por su hash determinista.
 */
function sanitizeIdempotencyKey(key: string): string {
	for (let i = 0; i < key.length; i++) {
		const code = key.charCodeAt(i);
		if (code > 0xff || code < 0x20) return hashIdempotency(key);
	}
	return key;
}

function isCircuitBreakerStatus(status?: number): status is number {
	return typeof status === "number" && status >= 400 && status < 600;
}

async function registerCircuitBreakerFailure(status?: number): Promise<boolean> {
	if (!isCircuitBreakerStatus(status)) return false;

	const currentSecond = Math.floor(Date.now() / 1000);
	if (failingBurstSecond !== currentSecond) {
		failingBurstSecond = currentSecond;
		failingBurstCount = 0;
	}

	failingBurstCount += 1;
	if (failingBurstCount < CIRCUIT_BREAKER_THRESHOLD || circuitBreakerTriggeredSecond === currentSecond) {
		return false;
	}

	circuitBreakerTriggeredSecond = currentSecond;
	failingBurstCount = 0;
	if (!IS_DEV) await forceLogoutAndRefresh();
	return true;
}

export interface RequestOptions<TData = Record<string, unknown>> {
	/** Query parameters */
	params?: Record<string, string | number | boolean | undefined | null>;
	/** Request body (auto-serialized to JSON) */
	body?: unknown;
	/** Additional headers for this request */
	headers?: HeadersInit;
	/** Translation params generator for error handling */
	translateParams?: (data: TData) => Record<string, string>;
	/**
	 * Idempotency key for mutative requests (POST/PUT/PATCH/DELETE).
	 * Use a stable string (e.g. resource ID, or `hashIdempotency(data)`).
	 */
	idempotencyKey?: string;
	/**
	 * Auto-generates a deterministic idempotency key by hashing this data.
	 * Shorthand for `idempotencyKey: hashIdempotency(data)`.
	 * Takes precedence over `idempotencyKey` if both are provided.
	 */
	idempotencyData?: unknown;
	silent?: boolean; // If true, suppresses error toasts
	/** AbortSignal to cancel the request */
	signal?: AbortSignal;
	/** If true, do not attach a CSRF header to this request */
	skipCsrf?: boolean;
}

/**
 * Builds a query string from an object, filtering out undefined/null values
 */
function buildQueryString(params?: Record<string, string | number | boolean | undefined | null>): string {
	if (!params) return "";
	const searchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			searchParams.append(key, String(value));
		}
	}
	const str = searchParams.toString();
	return str ? `?${str}` : "";
}

/**
 * Parses error response and throws ADCCustomError
 */
async function parseErrorResponse(response: Response): Promise<never> {
	let errorData: Record<string, unknown> = {};
	try {
		errorData = await response.json();
	} catch {
		// Response body not JSON, use status text
	}

	const error = new HttpError(
		(errorData.status as number) || response.status,
		(errorData.errorKey as string) || "HTTP_ERROR",
		(errorData.message as string) || response.statusText || "Error desconocido",
		errorData.data as Record<string, unknown>
	);
	throw error;
}

/**
 * Creates a configured API client with automatic error handling.
 *
 * @example
 * ```ts
 * // Create API instance
 * const authApi = createAdcApi({
 *   basePath: "/api/auth",
 *   devPort: 3000,
 *   credentials: "same-origin"
 * });
 *
 * // Use it
 * const result = await authApi.post<AuthResponse>("/login", {
 *   body: { username, password }
 * });
 *
 * if (result.success) {
 *   console.log(result.data.user);
 * }
 * ```
 */
export function createAdcApi(config: AdcApiConfig) {
	const { basePath, devPort, credentials = "same-origin", headers: defaultHeaders } = config;

	// Build base URL based on environment
	const baseUrl = IS_DEV && devPort ? getDevUrl(devPort, basePath) : basePath;

	async function request<T, TData = Record<string, unknown>>(
		method: HttpMethod,
		path: string,
		options: RequestOptions<TData> = {}
	): Promise<AdcFetchResult<T>> {
		const { params, body, headers, translateParams, idempotencyKey, idempotencyData, signal, skipCsrf } = options;
		const rawIdempotencyKey = idempotencyData !== undefined ? hashIdempotency(idempotencyData) : idempotencyKey;
		const resolvedIdempotencyKey = rawIdempotencyKey ? sanitizeIdempotencyKey(rawIdempotencyKey) : undefined;

		const url = `${baseUrl}${path}${buildQueryString(params)}`;
		const requestHeaders = {
			...defaultHeaders,
			...(body !== undefined ? { "Content-Type": "application/json" } : {}),
			...(MUTATIVE_METHODS.has(method) && resolvedIdempotencyKey ? { "Idempotency-Key": resolvedIdempotencyKey } : {}),
			...headers,
		};

		const fetchOptions: RequestInit = {
			method,
			credentials,
			headers: skipCsrf ? requestHeaders : await appendCsrfHeader(method, url, requestHeaders, credentials, signal),
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			...(signal ? { signal } : {}),
		};

		try {
			const response = await fetch(url, fetchOptions);

			if (!response.ok && !options.silent) {
				await parseErrorResponse(response);
			}

			// HEAD has no body; other non-OK silent responses are returned as success:false with status.
			if (method === "HEAD") {
				return { success: response.ok, status: response.status };
			}
			if (!response.ok) {
				return { success: false, status: response.status };
			}

			const data = (await response.json()) as T;
			return { success: true, data, status: response.status };
		} catch (err) {
			// Detect network-level errors (connection refused, offline, etc.)

			const isNetworkError =
				!(err instanceof ADCCustomError) &&
				err instanceof TypeError &&
				(err.message.includes("Failed to fetch") || err.message.includes("CONNECTION_REFUSED") || err.message.includes("NetworkError"));

			const errorKey = isNetworkError ? "CONNECTION_REFUSED" : (err as ADCCustomError).errorKey || "UNKNOWN_ERROR";
			const httpStatus = isNetworkError ? 503 : (err as ADCCustomError).status;
			const breakerTriggered = await registerCircuitBreakerFailure(httpStatus);

			// Extract error data and generate translation params
			let translationParams: Record<string, string> | undefined;
			if (err instanceof ADCCustomError && translateParams) {
				const errorData = (err.data || {}) as TData;
				translationParams = translateParams(errorData);
			}

			if (breakerTriggered) {
				return { success: false, errorKey };
			}

			// Dispatch error to adc-custom-error components
			if (!(options.silent || method === "HEAD"))
				showError({
					errorKey,
					message: (err as Error)?.message || "",
					data: {
						...(err as Record<string, unknown>),
						httpStatus,
						translationParams,
					},
				});

			return { success: false, errorKey };
		}
	}

	return {
		get: <T, TData = Record<string, unknown>>(path: string, options?: RequestOptions<TData>) => request<T, TData>("GET", path, options),
		post: <T, TData = Record<string, unknown>>(path: string, options?: RequestOptions<TData>) => request<T, TData>("POST", path, options),
		put: <T, TData = Record<string, unknown>>(path: string, options?: RequestOptions<TData>) => request<T, TData>("PUT", path, options),
		patch: <T, TData = Record<string, unknown>>(path: string, options?: RequestOptions<TData>) => request<T, TData>("PATCH", path, options),
		delete: <T, TData = Record<string, unknown>>(path: string, options?: RequestOptions<TData>) =>
			request<T, TData>("DELETE", path, options),
		head: <TData = Record<string, unknown>>(path: string, options?: RequestOptions<TData>) =>
			request<undefined, TData>("HEAD", path, options),
		/** Raw request with full control */
		request,
		/** The resolved base URL */
		baseUrl,
	};
}
