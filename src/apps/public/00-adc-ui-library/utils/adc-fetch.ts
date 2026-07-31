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
	/**
	 * Cuerpo parseado. **Indefinido en un 204/205**: la respuesta fue exitosa pero
	 * sin contenido (lista vacía, no-op idempotente). Comprobar `success` —y no la
	 * presencia de `data`— para saber si la request salió bien.
	 */
	data?: T;
	errorKey?: string;
	/**
	 * Mensaje de error del servidor. Sólo se rellena en modo `silent`.
	 */
	message?: string;
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
	 * Credentials mode for fetch requests.
	 * @default "include" en desarrollo (apps en puertos distintos ⇒ cross-origin),
	 * "same-origin" en producción (las APIs se sirven en el mismo origen).
	 * Política única de la plataforma: no hardcodear "include" en los clientes.
	 */
	credentials?: RequestCredentials;
	headers?: HeadersInit;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

const MUTATIVE_METHODS: ReadonlySet<HttpMethod> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CIRCUIT_BREAKER_THRESHOLD = 5;
/**
 * Respuestas exitosas SIN cuerpo. La plataforma usa 204 para "no hay contenido
 * que devolver" (colección vacía, mutación que no cambió nada); 404 queda para
 * "el recurso pedido por su identificador no existe".
 */
const NO_CONTENT_STATUSES: ReadonlySet<number> = new Set([204, 205]);

/** Política única de credentials de la plataforma (ver AdcApiConfig.credentials). */
export const DEFAULT_CREDENTIALS: RequestCredentials = IS_DEV ? "include" : "same-origin";

/** Timeout por defecto de cada request (evita requests colgadas indefinidamente). */
const REQUEST_TIMEOUT_MS = 30_000;
/** Reintentos automáticos ante errores de red, solo para métodos idempotentes. */
const RETRYABLE_METHODS: ReadonlySet<HttpMethod> = new Set(["GET", "HEAD"]);
const MAX_NETWORK_RETRIES = 2;

let failingBurstSecond = -1;
let failingBurstCount = 0;
let circuitBreakerTriggeredSecond = -1;

/**
 * Per-endpoint rate-limit "cooldown" memory. Cuando el server responde 429
 * registramos `${method}:${pathSinQuery}` con su `untilMs` y rechazamos
 * inmediatamente cualquier request al mismo endpoint hasta que expire, evitando
 * que componentes reactivos (e.g. UserPicker) generen avalanchas. Cap: 8h.
 */
const RATE_LIMIT_MAX_COOLDOWN_MS = 8 * 60 * 60 * 1000;
const rateLimitCooldowns = new Map<string, { until: number; errorKey: string }>();

function rateLimitKey(method: HttpMethod, url: string): string {
	const queryIdx = url.indexOf("?");
	const path = queryIdx === -1 ? url : url.slice(0, queryIdx);
	return `${method}:${path}`;
}

/** Cooldown vigente de un endpoint, con el motivo que lo originó (o `null`). */
function getRateLimitCooldown(method: HttpMethod, url: string): { remainingMs: number; errorKey: string } | null {
	const key = rateLimitKey(method, url);
	const entry = rateLimitCooldowns.get(key);
	if (!entry) return null;
	const remaining = entry.until - Date.now();
	if (remaining <= 0) {
		rateLimitCooldowns.delete(key);
		return null;
	}
	return { remainingMs: remaining, errorKey: entry.errorKey };
}

function registerRateLimit(method: HttpMethod, url: string, response: Response, body?: { retryAfter?: number; errorKey?: string }): void {
	const headerVal = response.headers.get("Retry-After");
	let seconds = 0;
	if (headerVal) {
		const n = Number(headerVal);
		if (Number.isFinite(n) && n > 0) seconds = n;
	}
	if (!seconds && body && typeof body.retryAfter === "number" && body.retryAfter > 0) {
		seconds = body.retryAfter;
	}

	if (!seconds) seconds = 30;
	const ms = Math.min(seconds * 1000, RATE_LIMIT_MAX_COOLDOWN_MS);
	// Barrido perezoso: purgar entradas expiradas al insertar (evita crecimiento indefinido).
	const now = Date.now();
	for (const [key, entry] of rateLimitCooldowns) {
		if (entry.until <= now) rateLimitCooldowns.delete(key);
	}
	// El motivo se guarda junto al vencimiento para que los reintentos durante el cooldown
	// muestren el mensaje real (un cupo mensual bloquea el endpoint durante horas).
	rateLimitCooldowns.set(rateLimitKey(method, url), { until: now + ms, errorKey: body?.errorKey || "RATE_LIMIT_EXCEEDED" });
}

/**
 * Deterministic hash for idempotency keys.
 * Produces the same key for the same data, enabling safe retries.
 */
function hashIdempotency(data: unknown): string {
	const str = JSON.stringify(data);
	let h = 5381;
	for (const ch of str) h = ((h << 5) + h + (ch.codePointAt(0) || 0)) >>> 0;
	return h.toString(36);
}

/**
 * Garantiza que el header `Idempotency-Key` solo contenga caracteres ISO-8859-1
 * imprimibles (HTTP no acepta unicode en headers). Si detecta caracteres fuera
 * de rango (e.g. emojis), reemplaza la clave por su hash determinista.
 */
function sanitizeIdempotencyKey(key: string): string {
	for (let i = 0; i < key.length; i++) {
		const code = key.codePointAt(i);
		if (code && (code > 0xff || code < 0x20)) return hashIdempotency(key);
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
 * Valida ids interpolados en paths de API (sanity-check temprano para UX/debug;
 * el backend siempre revalida). Devuelve el id codificado para URL.
 */
export function assertSafeId(value: string, name = "id"): string {
	if (!/^[\w.:@-]{1,128}$/.test(value)) {
		throw new HttpError(400, "INVALID_ID", `Parámetro "${name}" inválido`);
	}
	return encodeURIComponent(value);
}

/** Combina la señal del caller con un timeout automático (si la plataforma lo soporta). */
function withTimeoutSignal(signal: AbortSignal | undefined, ms: number): AbortSignal | undefined {
	const timeoutSignal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
	if (!timeoutSignal) return signal;
	if (!signal) return timeoutSignal;
	return AbortSignal.any ? AbortSignal.any([signal, timeoutSignal]) : signal;
}

/** fetch con reintentos exponenciales SOLO ante errores de red y métodos idempotentes. */
async function fetchWithRetry(url: string, init: RequestInit, method: HttpMethod): Promise<Response> {
	const attempts = RETRYABLE_METHODS.has(method) ? MAX_NETWORK_RETRIES + 1 : 1;
	let lastErr: unknown;
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await fetch(url, init);
		} catch (err) {
			lastErr = err;
			const aborted = err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
			if (aborted || attempt === attempts - 1) throw err;
			await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
		}
	}
	throw lastErr;
}

/** Clasifica un error de request (timeout / red / negocio) en errorKey + httpStatus. */
function classifyRequestError(err: unknown): { errorKey: string; httpStatus: number | undefined } {
	if (err instanceof DOMException && err.name === "TimeoutError") {
		return { errorKey: "REQUEST_TIMEOUT", httpStatus: 408 };
	}
	const isNetworkError =
		!(err instanceof ADCCustomError) &&
		err instanceof TypeError &&
		(err.message.includes("Failed to fetch") || err.message.includes("CONNECTION_REFUSED") || err.message.includes("NetworkError"));
	if (isNetworkError) {
		return { errorKey: "CONNECTION_REFUSED", httpStatus: 503 };
	}
	return { errorKey: (err as ADCCustomError).errorKey || "UNKNOWN_ERROR", httpStatus: (err as ADCCustomError).status };
}

/** Registra el cooldown de un 429 y resuelve la respuesta del cliente (lanza toast salvo silent). */
async function handleRateLimitedResponse(
	method: HttpMethod,
	url: string,
	response: Response,
	silent: boolean | undefined
): Promise<AdcFetchResult<never>> {
	let parsedBody: { retryAfter?: number; errorKey?: string; message?: string } | undefined;
	try {
		parsedBody = (await response.clone().json()) as { retryAfter?: number; errorKey?: string; message?: string };
	} catch {
		/* body opcional */
	}
	registerRateLimit(method, url, response, parsedBody);
	if (!silent) {
		await parseErrorResponse(response);
	}
	// El `errorKey` del cuerpo manda: no cada 429 es un rate limit. Las cuotas de plan
	// (`EGRESS_QUOTA_EXCEEDED`, `TRANSFER_LIMIT`, …) también responden 429, y el caller necesita
	// distinguir "esperá unos segundos" de "se te acabó el cupo del mes".
	return { success: false, status: 429, errorKey: parsedBody?.errorKey || "RATE_LIMIT_EXCEEDED", message: parsedBody?.message };
}

/**
 * Traduce una respuesta HTTP ya recibida al `AdcFetchResult` del cliente.
 * Con `silent` falso, los errores se propagan como `HttpError` (los captura
 * `request` para disparar el toast); con `silent` se devuelven como resultado.
 */
async function toFetchResult<T>(method: HttpMethod, response: Response, silent?: boolean): Promise<AdcFetchResult<T>> {
	if (!response.ok && !silent) {
		await parseErrorResponse(response);
	}

	// HEAD has no body; other non-OK silent responses are returned as success:false with status.
	if (method === "HEAD") {
		return { success: response.ok, status: response.status };
	}

	if (!response.ok) {
		// Silent path: `silent` suprime el toast, NO el error. Extraemos clave y
		// mensaje de negocio para que el caller decida cómo mostrarlo.
		let errorKey: string | undefined;
		let message: string | undefined;
		try {
			const body = (await response.json()) as { errorKey?: string; message?: string };
			errorKey = body?.errorKey;
			message = body?.message;
		} catch {
			/* respuesta sin body JSON */
		}
		return { success: false, status: response.status, errorKey, message };
	}

	// Sin contenido (204/205): respuesta exitosa y sin body. `response.json()`
	// reventaría con un cuerpo vacío, así que se resuelve como éxito con `data`
	// indefinido (ver AdcFetchResult.data).
	if (NO_CONTENT_STATUSES.has(response.status)) {
		return { success: true, status: response.status };
	}

	const data = (await response.json()) as T;
	return { success: true, data, status: response.status };
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
	const { basePath, devPort, credentials = DEFAULT_CREDENTIALS, headers: defaultHeaders } = config;

	// Build base URL based on environment
	const baseUrl = IS_DEV && devPort ? getDevUrl(devPort, basePath) : basePath;

	async function request<T, TData = Record<string, unknown>>(
		method: HttpMethod,
		path: string,
		options: RequestOptions<TData> = {}
	): Promise<AdcFetchResult<T>> {
		const { params, body, headers, translateParams, idempotencyKey, idempotencyData, signal, skipCsrf } = options;
		const rawIdempotencyKey = idempotencyData === undefined ? idempotencyKey : hashIdempotency(idempotencyData);
		const resolvedIdempotencyKey = rawIdempotencyKey ? sanitizeIdempotencyKey(rawIdempotencyKey) : undefined;

		const url = `${baseUrl}${path}${buildQueryString(params)}`;
		const requestHeaders = {
			...defaultHeaders,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
			...(MUTATIVE_METHODS.has(method) && resolvedIdempotencyKey ? { "Idempotency-Key": resolvedIdempotencyKey } : {}),
			...headers,
		};

		const fetchOptions: RequestInit = {
			method,
			credentials,
			headers: skipCsrf ? requestHeaders : await appendCsrfHeader(method, url, requestHeaders, credentials, signal),
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		};
		const effectiveSignal = withTimeoutSignal(signal, REQUEST_TIMEOUT_MS);
		if (effectiveSignal) fetchOptions.signal = effectiveSignal;

		// Cortar avalanchas: si el endpoint está en cooldown por 429, no salir a la red.
		const cooldown = getRateLimitCooldown(method, url);
		if (cooldown) {
			return { success: false, status: 429, errorKey: cooldown.errorKey };
		}

		try {
			const response = await fetchWithRetry(url, fetchOptions, method);

			if (response.status === 429) {
				return await handleRateLimitedResponse(method, url, response, options.silent);
			}

			return await toFetchResult<T>(method, response, options.silent);
		} catch (err) {
			// Detect network-level errors (connection refused, offline, etc.)
			const { errorKey, httpStatus } = classifyRequestError(err);
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
