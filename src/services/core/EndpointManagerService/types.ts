export { UncommonResponse, type CookieOptions, type SetCookie, type ClearCookie } from "./parts/UncommonResponse.js";

/** HTTP methods supported */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

/** Endpoint configuration for @RegisterEndpoint decorator */
export interface EndpointConfig {
	method: HttpMethod;
	url: string;
	permissions?: string[];
	/**
	 * Si es `true`, el validador verifica el token (pobla `ctx.user`)
	 * Si no, El DAO debe autorizar vía Requests.
	 */
	deferAuth?: boolean;
	/**
	 * Si es `true`, exige sesión válida (401 si no hay usuario autenticado) sin
	 * chequear permisos concretos: la autorización fina la hace el DAO por scope.
	 * Preferir esto sobre `deferAuth` cuando el endpoint NUNCA debe ejecutarse anónimo.
	 */
	requireAuth?: boolean;
	options?: EndpointOptions;
}

/** Optional endpoint configuration */
interface EndpointOptions {
	/** Rate limit per IP. timeWindow is in milliseconds. */
	rateLimit?: { max: number; timeWindow: number };
	/**
	 * Schemas de validación de entrada. Usar `Type` de `@sinclair/typebox`:
	 * se validan en cada request (400 con detalles) y alimentan el doc OpenAPI
	 * en `/api/docs`. JSON Schema plano también es aceptado (solo documentación,
	 * sin validación runtime).
	 */
	schema?: {
		body?: Record<string, unknown>;
		querystring?: Record<string, unknown>;
		params?: Record<string, unknown>;
		/**
		 * Schemas de respuesta por código de estado (ej. `"200"`, `"404"`). Solo
		 * documentación: alimentan el doc OpenAPI en `/api/docs`, NO se validan en
		 * runtime. Usar `Type` de `@sinclair/typebox`.
		 *
		 * Los códigos sin cuerpo (204/205/304) se documentan únicamente con su
		 * descripción: `204: Type.Null({ description: "Bandeja vacía" })`. Un
		 * handler que devuelve `undefined`/`null` responde 204 automáticamente.
		 */
		response?: Record<string, Record<string, unknown>>;
	};
	/**
	 * Sub-tag OpenAPI para agrupar el endpoint en Swagger UI. Convención:
	 * `"Servicio/Recurso"` (ej. `"IdentityManagerService/Users"`). Si se omite,
	 * se usa el nombre del servicio (`ownerName`). Los sub-tags que comparten
	 * prefijo se agrupan y ordenan juntos en `/api/docs`.
	 */
	tag?: string;
	/** Resumen de una línea mostrado como título del endpoint en Swagger UI. */
	summary?: string;
	/** Descripción larga (markdown) del endpoint para el doc OpenAPI. */
	description?: string;
	/** Marca el endpoint como obsoleto (`deprecated`) en el doc OpenAPI. */
	deprecated?: boolean;
	/**
	 * Código de éxito cuando el handler devuelve contenido. Por defecto `200`;
	 * usar `201` en los POST que **crean** un recurso nuevo. Devolver
	 * `undefined`/`null` sigue respondiendo `204` (ver docs/architecture/http-status.md).
	 */
	successStatus?: 200 | 201;
	/**
	 * Cabeceras de cache para respuestas GET 200 (las absorben CDN/navegador).
	 * Sólo se aplica a método GET; ignorado en mutativos.
	 */
	cache?: { maxAge: number; staleWhileRevalidate?: number; scope?: "public" | "private" };
	/**
	 * Valida el cuerpo con `ETag` + `If-None-Match` y responde `304` sin cuerpo si
	 * el cliente ya tiene la versión vigente. Sólo GET. Pensado para endpoints que
	 * se pollean (semáforo de estado, contadores): el navegador revalida solo y
	 * el JS recibe el cuerpo cacheado, así que los clientes no cambian.
	 *
	 * `{ ignore: [...] }` excluye claves de primer nivel del hash: un campo que
	 * cambia en cada request (`generatedAt` y compañía) haría que el ETag nunca
	 * coincida y el 304 no se dispararía nunca.
	 */
	etag?: boolean | { ignore: string[] };
	/** Skip automatic idempotency check for this endpoint (default: false). */
	skipIdempotency?: boolean;
	/** Skip cookie-auth CSRF validation for this endpoint (default: false). */
	skipCsrf?: boolean;
	/**
	 * When true (and the method is mutative: POST/PUT/PATCH/DELETE), the request
	 * is enqueued into RabbitMQ after idempotency+permissions checks and the HTTP
	 * response is always 202 Accepted with a jobId for polling.
	 */
	enqueue?: boolean;
	/** Queue consumer options - only meaningful when enqueue=true */
	queueOptions?: {
		prefetch?: number;
		concurrency?: number;
		maxRetries?: number;
		/** Max time (ms) a handler may run before timeout */
		jobTimeoutMs?: number;
	};
	[key: string]: unknown;
}

/** Job status stored in Redis for async (enqueued) operations */
export interface JobStatus {
	status: "queued" | "processing" | "completed" | "failed";
	endpoint: string;
	userId?: string;
	result?: unknown;
	error?: string;
	createdAt: string;
	completedAt?: string;
}

/** Context passed to endpoint handlers */
export interface EndpointCtx<P = Record<string, string>, D = unknown> {
	params: P;
	query: Record<string, string | undefined>;
	data: D;
	user: AuthenticatedUserInfo | null;
	token: string | null;
	/** Request cookies (read-only) */
	cookies: Record<string, string | undefined>;
	/** Request headers (read-only) */
	headers: Record<string, string | undefined>;
	/**
	 * IP del cliente, que el cliente nunca elige: sale de `X-Forwarded-For` descartando los saltos
	 * de `TRUSTED_PROXIES`, o del socket si no hay lista. La única grabable/baneable/cuotificable.
	 */
	ip: string;
	/**
	 * La request entró por un proxy de `TRUSTED_PROXIES`, así que se les puede creer a los headers
	 * propios del edge (`CF-IPCountry`), que `trustProxy` no valida. Ver `security/trusted-proxies.ts`.
	 */
	viaTrustedProxy: boolean;
}

/** Authenticated user information */
export interface AuthenticatedUserInfo {
	id: string;
	username: string;
	email?: string;
	avatar?: string;
	permissions: string[];
	orgId?: string;
	metadata?: Record<string, unknown>;
}

/** Handler function signature */
export type EndpointHandler<P = Record<string, string>, D = unknown, R = unknown> = (ctx: EndpointCtx<P, D>) => Promise<R> | R;

/** Registered endpoint metadata */
export interface RegisteredEndpoint {
	id: string;
	method: HttpMethod;
	url: string;
	permissions: string[];
	options?: EndpointOptions;
	instance: object;
	methodName: string;
	handler: EndpointHandler<any, any, any>;
	ownerName: string;
}

/** EnableEndpoints configuration */
export interface EnableEndpointsConfig {
	managers?: () => object[];
}
