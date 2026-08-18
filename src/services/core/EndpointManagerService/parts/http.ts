import type { FastifyRequest, FastifyReply } from "../../../../interfaces/modules/providers/IHttpServer.js";
import { UncommonResponse, type RegisteredEndpoint, type EndpointCtx, type AuthenticatedUserInfo, type HttpMethod } from "../types.js";
import ADCCustomError, { HttpError } from "@common/types/ADCCustomError.js";
import { IdempotencyError } from "@common/types/custom-errors/IdempotencyError.ts";
import type { ISessionVerifier } from "@common/types/identity/SessionVerifier.ts";
import type { IOperationsService } from "@common/types/operations/IOperationsService.js";
import type RabbitMQProvider from "../../../../providers/queue/rabbitmq/index.ts";
import type RedisProvider from "../../../../providers/queue/redis/index.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.d.ts";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { pipeStreamToRaw } from "@common/utils/http-stream.ts";
import { validateCsrf, type TokenSource } from "./csrf.js";
import type { CsrfRuntimeConfig } from "./csrf-config.js";
import { consumeRateLimit, resolveRateLimit, shouldWarnDegraded, type ResolvedRateLimits } from "./rate-limit.js";
import { assertNoOperatorKeys, compileEndpointSchemas, validateEndpointInput } from "./schema.js";
import { sealJobToken } from "./job-token.js";
import { isRecording, record } from "./metrics.js";
import { isTrustedProxyPeer } from "@providers/http/fastify-server/security/index.js";

const MUTATIVE_METHODS: ReadonlySet<HttpMethod> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const JOB_TTL_SECONDS = 600; // 10 min

/**
 * Deadline del handler. En este runtime `requestTimeout`/`connectionTimeout` de Fastify quedan en 0
 * y no se aplican (ver `security/traffic-shaper.ts`), así que un handler que espera para siempre a
 * una dependencia atascada retiene el socket hasta que el cliente se rinde — y las conexiones se
 * acumulan sin techo. Esto lo convierte en un 504 rápido.
 *
 * Sólo lecturas por defecto: una mutación puede tardar legítimamente (un deploy, un build, una
 * subida grande) y cortarla rompería flujos reales; un GET que pasa de 15s ya está roto. Se ajusta
 * por endpoint con `options.timeoutMs` (`0` lo desactiva).
 */
const DEFAULT_HANDLER_TIMEOUT_MS = 15_000;

function resolveHandlerTimeout(endpoint: RegisteredEndpoint): number {
	const declared = endpoint.options?.timeoutMs;
	if (typeof declared === "number") return declared > 0 ? declared : 0;
	return endpoint.method === "GET" || endpoint.method === "HEAD" ? DEFAULT_HANDLER_TIMEOUT_MS : 0;
}

/**
 * El handler NO se cancela (no hay forma): sigue corriendo y su resultado se descarta. Por eso se
 * le engancha un `catch` vacío — un rechazo tardío sin manejar tumba el proceso en Bun.
 */
async function withHandlerTimeout<T>(work: Promise<T>, timeoutMs: number, endpoint: RegisteredEndpoint, logger: ILogger): Promise<T> {
	if (timeoutMs <= 0) return work;

	let timer: ReturnType<typeof setTimeout> | undefined;
	work.catch(() => {
		/* ver docstring */
	});
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					// El 504 sale como error de negocio y nadie lo loguea: sin esta línea un endpoint
					// atascado se vuelve invisible, que es justo lo que había que dejar de tener.
					logger.logWarn(`[timeout] ${endpoint.method} ${endpoint.url} pasó de ${timeoutMs}ms; se responde 504`);
					reject(new HttpError(504, "ENDPOINT_TIMEOUT", "El servidor tardó demasiado en responder"));
				}, timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

interface ExtractedToken {
	token: string | null;
	source: TokenSource;
}

/** Resolución del token de sesión: cookie primero, `Authorization: Bearer` después. */
export function extractToken(req: FastifyRequest<any>, getSessionManager: () => ISessionVerifier | null): ExtractedToken {
	// 1. Intentar desde cookie via SessionManager
	const sessionManager = getSessionManager();
	if (sessionManager) {
		const cookieToken = sessionManager.extractSessionToken(req as any);
		if (cookieToken) return { token: cookieToken, source: "cookie" };
	}

	// 2. Intentar desde header Authorization
	const authHeader = req.headers?.authorization;
	if (authHeader?.startsWith("Bearer ")) {
		return { token: authHeader.substring(7), source: "bearer" };
	}

	// El token de sesión NO se acepta por query string: una URL termina en logs de proxy, en el
	// historial del navegador, en `Referer` y —en dev— en la línea de request sin redactar que
	// loguea el provider HTTP. Los consumidores que no pueden poner headers (los SSE de
	// `adc-notification-bell` y del agente del túnel de Drive) abren `EventSource` con
	// `withCredentials: true`, o sea cookie same-origin; los clientes CLI mandan
	// `Authorization: Bearer`.
	return { token: null, source: null };
}

/** Clave de idempotencia de la request, o 400 si el endpoint la exige y no vino. */
function requireIdempotencyKey(req: FastifyRequest<any>): string {
	const key = req.headers["idempotency-key"] as string | undefined;
	if (!key) throw new IdempotencyError(400, "IDEMPOTENCY_KEY_MISSING", "Header Idempotency-Key is required for this operation");
	return key;
}

export function createHttpWrapper(
	endpoint: RegisteredEndpoint,
	getSessionManager: () => ISessionVerifier | null,
	operationsService: IOperationsService,
	logger: ILogger,
	csrfConfig: CsrfRuntimeConfig,
	rateLimits: ResolvedRateLimits,
	rabbitmq: RabbitMQProvider | null = null,
	redis: RedisProvider | null = null,
	/**
	 * Si devuelve un objeto, el owner del endpoint está marcado como no disponible
	 * (servicio detenido por el modules-manager) y la ruta responde 503 sin invocar
	 * el handler. La ruta permanece registrada en Fastify; "re-registra" 503.
	 */
	checkUnavailable: () => { message?: string } | null = () => null
): (req: FastifyRequest<any>, reply: FastifyReply<any>) => Promise<void> {
	const requiresIdempotency = MUTATIVE_METHODS.has(endpoint.method) && endpoint.options?.skipIdempotency !== true;
	const shouldEnqueue = MUTATIVE_METHODS.has(endpoint.method) && endpoint.options?.enqueue === true && rabbitmq !== null;
	const rl = resolveRateLimit(endpoint, rateLimits);
	const rlTtlSeconds = rl ? Math.max(1, Math.ceil(rl.timeWindow / 1000)) : 0;
	const rlKeyPrefix = rl ? `rl:${endpoint.method}:${endpoint.url}:` : "";
	// Clave de métricas estable: el patrón de ruta, NO `endpoint.id` (se regenera en cada hot-reload).
	const metricKey = `${endpoint.method} ${endpoint.url}`;
	/** `cmd` del guard de idempotencia y etiqueta del job encolado: constante por endpoint. */
	const idempotencyCmd = `${endpoint.method}:${endpoint.url}`;
	const handlerTimeoutMs = resolveHandlerTimeout(endpoint);
	// Schemas TypeBox compilados una sola vez por endpoint (S-11)
	const compiledSchemas = compileEndpointSchemas(endpoint);

	return async (req: FastifyRequest<any>, reply: FastifyReply<any>) => {
		const startedAt = performance.now();
		let escapedStatus = 0;
		try {
			// ── Service Unavailable (módulo detenido por el modules-manager) ──
			const unavailable = checkUnavailable();
			if (unavailable) {
				reply.header("Retry-After", "30");
				reply.status(503).send({
					error: "SERVICE_UNAVAILABLE",
					message: unavailable.message || "Servicio temporalmente no disponible",
				});
				return;
			}

			// ── Rate limiting (Redis: INCR + TTL en una operación atómica) ──
			// La clave es `req.ip`, que no es falsificable por un header en ninguno de los dos
			// modos: sin `TRUSTED_PROXIES` es la IP del socket, y con la lista fastify la resuelve
			// desde `X-Forwarded-For` descartando los saltos confiables. Detrás de un edge sin la
			// lista declarada, en cambio, todos los usuarios comparten bucket.
			//
			// Sin Redis (caído o no declarado) el contador cae a memoria del proceso: el límite no
			// puede evaporarse, que es justo lo que hacía falta para las superficies públicas.
			if (rl) {
				const key = rlKeyPrefix + req.ip;
				const { count, degraded } = await consumeRateLimit(redis, key, rlTtlSeconds);
				if (degraded && shouldWarnDegraded()) {
					logger.logWarn("[rate-limit] Redis no disponible: contando en memoria (límite por proceso, no global)");
				}

				reply.header("X-RateLimit-Limit", rl.max);
				reply.header("X-RateLimit-Remaining", Math.max(0, rl.max - count));

				if (count > rl.max) {
					reply.header("Retry-After", rlTtlSeconds);
					reply.status(429).send({
						error: "RATE_LIMIT_EXCEEDED",
						message: `Too many requests. Limit: ${rl.max} per ${rlTtlSeconds}s`,
					});
					return;
				}
			}

			// Extraer token si existe
			const tokenInfo = extractToken(req, getSessionManager);
			const token = tokenInfo.token;

			// Obtener usuario si hay token (ya sea público o protegido)
			let user: AuthenticatedUserInfo | null = null;
			const sessionManager = getSessionManager();
			if (token && sessionManager) {
				const result = await sessionManager.verifyToken(token);
				if (result.valid && result.session) {
					user = result.session.user;
				}
			}

			const ctx: EndpointCtx<any, any> = {
				params: (req.params as Record<string, string>) || {},
				query: (req.query as Record<string, string | undefined>) || {},
				data: req.body,
				user,
				token,
				cookies: ((req as any).cookies as Record<string, string | undefined>) || {},
				headers: req.headers as Record<string, string | undefined>,
				ip: req.ip,
				viaTrustedProxy: isTrustedProxyPeer(req.socket?.remoteAddress),
			};

			try {
				validateCsrf(endpoint, req, tokenInfo.source, csrfConfig);

				// Claves de operador de Mongo: SIEMPRE, tenga schema o no. Dentro de
				// `validateEndpointInput` quedarían sin cubrir los endpoints sin schema declarativo,
				// que son los más expuestos.
				assertNoOperatorKeys(ctx.data, "body");
				assertNoOperatorKeys(ctx.query, "query");

				// Validación declarativa de entrada (TypeBox) antes del handler
				if (compiledSchemas) validateEndpointInput(compiledSchemas, ctx);

				let result: unknown;

				// La clave se exige sólo si el endpoint la pide. `const` (y no `let`) para que
				// TypeScript la estreche a `string` dentro del closure de `guarded`.
				const guardKey = requiresIdempotency ? requireIdempotencyKey(req) : undefined;

				/**
				 * Corre `op` bajo el guard de idempotencia, o directamente si el endpoint lo exime.
				 * Mantiene **encolar e idempotencia independientes**: `skipIdempotency` no debe
				 * desactivar `enqueue`.
				 */
				const guarded = <T>(op: () => Promise<T>): Promise<T> =>
					guardKey === undefined ? op() : operationsService.httpCheck(idempotencyCmd, guardKey, op);

				if (shouldEnqueue && redis) {
					// ── Enqueue path: always respond 202 ──────────────────────────
					result = await guarded(async () => {
						const jobId = crypto.randomUUID();

						// Persist job status in Redis
						const jobData = JSON.stringify({
							status: "queued",
							endpoint: idempotencyCmd,
							userId: ctx.user?.id,
							createdAt: new Date().toISOString(),
						});
						await redis.setex(`job:${jobId}`, JOB_TTL_SECONDS, jobData);

						// El token va a Redis (no a la cola) para que el consumidor pueda re-verificar
						// la sesión. Cifrado en reposo: Redis no tiene auth y esto es una sesión viva.
						// El hash que viaja por AMQP es del token EN CLARO, así que el consumidor lo
						// compara después de abrir el sobre.
						let tokenHash = "";
						if (token) {
							tokenHash = createHash("sha256").update(token).digest("hex");
							await redis.setex(`job-token:${jobId}`, JOB_TTL_SECONDS, sealJobToken(token, logger));
						}

						// Publish minimal payload to RabbitMQ
						await rabbitmq.publish(
							endpoint.ownerName,
							endpoint.methodName,
							{
								jobId,
								endpoint: idempotencyCmd,
								methodName: endpoint.methodName,
								params: ctx.params,
								data: ctx.data,
								userId: ctx.user?.id,
								orgId: ctx.user?.orgId,
							},
							{
								// Informativa: hoy nadie la lee en el consumidor. Se omite si el
								// endpoint no exige clave, en vez de mandar una vacía que mienta.
								...(guardKey ? { "x-idempotency-key": guardKey } : {}),
								"x-job-id": jobId,
								"x-retry-count": "0",
								"x-token-hash": tokenHash,
							}
						);

						return { jobId, status: "queued", pollUrl: `/api/jobs/${jobId}` };
					});

					reply.status(202).send(result);
					return;
				}

				result = await withHandlerTimeout(
					guarded(() => endpoint.handler(ctx)),
					handlerTimeoutMs,
					endpoint,
					logger
				);

				// El handler devuelve datos, nosotros manejamos la respuesta HTTP
				if (result === undefined || result === null) {
					reply.status(204).send();
					return;
				}
				applyCacheHeaders(endpoint, ctx, reply);
				if (sendNotModified(endpoint, ctx, reply, result)) return;
				reply.status(endpoint.options?.successStatus ?? 200).send(result);
			} catch (error: any) {
				await handleEndpointError(error, endpoint, ctx, reply, logger);
			}
		} catch (error) {
			// Excepción que escapó de todo (p.ej. Redis caído en el rate limit, antes de armar el ctx):
			// Fastify responde 500, así que la métrica no puede anotarla como el 200 que sigue en `reply`.
			escapedStatus = 500;
			throw error;
		} finally {
			// Métrica best-effort: pase lo que pase acá, la respuesta ya salió y no se puede romper.
			try {
				record(metricKey, endpoint.ownerName, performance.now() - startedAt, bodyBytes(reply), escapedStatus || reply.statusCode);
			} catch {
				/* las métricas nunca deben afectar a la request */
			}
		}
	};
}

/**
 * Bytes del cuerpo ya enviado, leídos del `content-length` que calculó Fastify. `send()` lo fija de
 * forma SÍNCRONA, así que el dato ya está y no hay que re-serializar el payload para la métrica.
 *
 * `null` = no medido (204/304, respuestas hijackeadas, streams sin longitud), que NO es lo mismo
 * que `0` bytes reales.
 */
function bodyBytes(reply: FastifyReply<any>): number | null {
	if (!isRecording()) return null;
	// Fallback a `raw`: quien escribe directo sobre el socket (SSE, túnel) no pasa por reply.header().
	const raw = reply.getHeader("content-length") ?? (reply.raw as any)?.getHeader?.("content-length");
	if (raw === undefined || raw === null || raw === "") return null;
	const bytes = Number(raw);
	return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
}

/** Cabeceras de cache declarativas (`options.cache`/`options.etag`). Sólo GET. */
function applyCacheHeaders(endpoint: RegisteredEndpoint, ctx: EndpointCtx<any, any>, reply: FastifyReply<any>): void {
	if (endpoint.method !== "GET") return;
	const cache = endpoint.options?.cache;
	if (cache) {
		// Una respuesta `public` la guarda el CDN y se la sirve a cualquiera, así que sólo se emite
		// cuando la request NO trajo credenciales: la misma URL puede devolver de más a quien tiene
		// permisos, y cachear ESA copia sería publicarla. Con credenciales degrada a `private`
		// (el navegador la guarda, ninguna caché compartida).
		const declared = cache.scope ?? "public";
		const scope = declared === "public" && (ctx.token || ctx.user) ? "private" : declared;
		const parts = [scope, `max-age=${cache.maxAge}`];
		if (cache.staleWhileRevalidate) parts.push(`stale-while-revalidate=${cache.staleWhileRevalidate}`);
		// `stale-if-error` es lo que hace que una superficie pública sobreviva a la caída del
		// origen: el CDN sigue sirviendo la última copia buena en vez de propagar el 5xx.
		if (cache.staleIfError) parts.push(`stale-if-error=${cache.staleIfError}`);
		reply.header("Cache-Control", parts.join(", "));
	} else if (endpoint.options?.etag) {
		// Sin política de cache propia: el navegador guarda la copia pero revalida
		// SIEMPRE contra el ETag, que es lo que habilita el 304.
		reply.header("Cache-Control", "private, no-cache");
	}
}

/** Cuerpo sin las claves volátiles declaradas en `options.etag.ignore`. */
function stableBody(result: unknown, config: NonNullable<RegisteredEndpoint["options"]>["etag"]): unknown {
	if (typeof config === "boolean" || !config?.ignore.length) return result;
	if (typeof result !== "object" || result === null || Array.isArray(result)) return result;
	const copy: Record<string, unknown> = { ...(result as Record<string, unknown>) };
	for (const key of config.ignore) delete copy[key];
	return copy;
}

/**
 * ETag débil del cuerpo + `304 Not Modified` si el cliente ya tiene esa versión.
 * Devuelve `true` si ya respondió (el caller no debe enviar cuerpo).
 */
function sendNotModified(endpoint: RegisteredEndpoint, ctx: EndpointCtx<any, any>, reply: FastifyReply<any>, result: unknown): boolean {
	const config = endpoint.options?.etag;
	if (!config || endpoint.method !== "GET") return false;

	const etag = `W/"${createHash("sha1")
		.update(JSON.stringify(stableBody(result, config)))
		.digest("base64url")}"`;
	reply.header("ETag", etag);

	const ifNoneMatch = ctx.headers?.["if-none-match"];
	if (!ifNoneMatch?.split(",").some((tag) => tag.trim() === etag)) return false;
	reply.status(304).send();
	return true;
}

/**
 * `Retry-After` en respuestas reintentables. Sale de `data.retryAfter` o
 * `data.retryAfterSeconds` (segundos) y, si no viene, 30s para los 503. Importa en las
 * cuotas: sin el header el cliente asume 30s y machaca un límite que puede durar días.
 *
 * Los dos nombres conviven en el código: los errores tipados del core traen `retryAfterSeconds`
 * y las cuotas de los presets usan `retryAfter`.
 */
function applyRetryAfter(error: ADCCustomError, reply: FastifyReply<any>): void {
	const data = error.data as { retryAfter?: unknown; retryAfterSeconds?: unknown } | undefined;
	const declared = typeof data?.retryAfter === "number" ? data.retryAfter : data?.retryAfterSeconds;
	let seconds = null;
	if (typeof declared === "number" && declared > 0) seconds = Math.ceil(declared);
	else if (error.status === 503) seconds = 30;
	if (seconds !== null) reply.header("Retry-After", String(seconds));
}

/** Maneja UncommonResponse, errores de negocio y errores inesperados de un endpoint. */
async function handleEndpointError(
	error: any,
	endpoint: RegisteredEndpoint,
	ctx: EndpointCtx<any, any>,
	reply: FastifyReply<any>,
	logger: ILogger
): Promise<void> {
	// Capturar UncommonResponse para respuestas especiales (cookies, redirects)
	if (error instanceof UncommonResponse) {
		await sendUncommonResponse(error, reply, ctx.headers?.range, endpoint, logger);
		return;
	}

	// Capturar ADCCustomError (HttpError, IdempotencyError y otros) para errores de negocio
	if (error instanceof ADCCustomError) {
		// Auditoría de denegaciones de authz/authn para detectar intentos de escalación.
		// Un 401 sin ninguna credencial presentada no es un intento de escalación: es el
		// caso normal de visitante anónimo (sondas tipo `GET /api/auth/session`), así que
		// va a debug para no ahogar el log de auditoría con ruido.
		if (error.status === 401 || error.status === 403) {
			const line = `[AUTHZ-DENY] ${endpoint.method} ${endpoint.url} status=${error.status} user=${ctx.user?.id ?? "anon"} ip=${ctx.ip}`;
			if (error.status === 401 && !ctx.token && !ctx.user) logger.logDebug(line);
			else logger.logWarn(line);
		}
		applyRetryAfter(error, reply);
		reply.status(error.status).send(error.toJSON());
		return;
	}

	// Error inesperado: nunca exponer detalles internos al cliente (en ningún entorno).
	// El mensaje/stack completo va a logs del servidor, correlacionado por ID.
	const correlationId = crypto.randomUUID();
	const stack = error.stack ? `\n${error.stack}` : "";
	logger.logError(`[${correlationId}] Error en endpoint ${endpoint.method} ${endpoint.url}: ${error.message}` + stack);

	reply.status(500).send({ error: "INTERNAL_ERROR", message: "Error interno del servidor", correlationId });
}

/** Envía una UncommonResponse (cookies, headers custom, redirect, stream o JSON). */
async function sendUncommonResponse(
	error: UncommonResponse,
	reply: FastifyReply<any>,
	range: string | undefined,
	endpoint: RegisteredEndpoint,
	logger: ILogger
): Promise<void> {
	const rep = reply as any;
	for (const cookie of error.cookies) {
		rep.setCookie(cookie.name, cookie.value, cookie.options || {});
	}
	for (const cookie of error.clearCookies) {
		rep.clearCookie(cookie.name, cookie.options || {});
	}
	if (error.type === "redirect") {
		for (const [name, value] of Object.entries(error.headers)) reply.header(name, value);
		reply.status(error.status).redirect(error.redirectUrl!);
		return;
	}
	if (error.type === "stream") {
		// Por el socket crudo, sin materializar el cuerpo (ver `pipeStreamToRaw`).
		//
		// `Range` es asunto del PRODUCTOR, no de esta capa: honrarlo acá exigiría materializar el
		// cuerpo para cortarlo. Los endpoints que saben servir un tramo (contenido de Drive) empujan
		// el rango hasta el origen y llegan acá con 206 y `Content-Range` ya armados; para el resto,
		// responder 200 completo es válido. El log detecta endpoints donde el seek haría falta.
		if (range && error.status !== 206) {
			logger.logDebug(`Range ignorado en respuesta de stream (${endpoint.method} ${endpoint.url}): se envía 200 completo.`);
		}
		// Tras `hijack()` nadie serializa los headers pendientes (cookies, `X-RateLimit-*`): se
		// mergean a mano o se pierden en silencio.
		const headers: Record<string, string | string[]> = {};
		for (const [name, value] of Object.entries(rep.getHeaders?.() ?? {})) {
			if (value !== undefined && value !== null) headers[name] = value as string | string[];
		}
		for (const [name, value] of Object.entries(error.headers)) headers[name] = String(value);
		// `hijack()` ANTES de tocar el socket, o Fastify escribe sus headers sobre los ya enviados.
		reply.hijack();
		pipeStreamToRaw(error.body as Readable, reply.raw, error.status, headers, (e: unknown) =>
			logger.logWarn(`Stream interrumpido en ${endpoint.method} ${endpoint.url}: ${e}`)
		);
		return;
	}
	for (const [name, value] of Object.entries(error.headers)) reply.header(name, value);
	reply.status(error.status).send(error.body);
}
