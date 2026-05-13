import type { FastifyRequest, FastifyReply } from "../../../../interfaces/modules/providers/IHttpServer.js";
import { UncommonResponse, type RegisteredEndpoint, type EndpointCtx, type AuthenticatedUserInfo, type HttpMethod } from "../types.js";
import ADCCustomError from "@common/types/ADCCustomError.js";
import { IdempotencyError } from "@common/types/custom-errors/IdempotencyError.ts";
import type SessionManagerService from "../../../security/SessionManagerService/index.ts";
import type OperationsService from "../../OperationsService/index.ts";
import type RabbitMQProvider from "../../../../providers/queue/rabbitmq/index.ts";
import type RedisProvider from "../../../../providers/queue/redis/index.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.d.ts";
import { createHash } from "node:crypto";
import { validateCsrf, type TokenSource } from "./csrf.js";
import type { CsrfRuntimeConfig } from "./csrf-config.js";
import { resolveRateLimit } from "./rate-limit.js";

const MUTATIVE_METHODS: ReadonlySet<HttpMethod> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const JOB_TTL_SECONDS = 600; // 10 min

interface ExtractedToken {
	token: string | null;
	source: TokenSource;
}

function extractToken(req: FastifyRequest<any>, getSessionManager: () => SessionManagerService | null): ExtractedToken {
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

	// 3. Intentar desde query parameter (para WebSockets, etc.)
	const queryToken = (req.query as any)?.token;
	if (queryToken) {
		return { token: queryToken, source: "query" };
	}

	return { token: null, source: null };
}

export function createHttpWrapper(
	endpoint: RegisteredEndpoint,
	getSessionManager: () => SessionManagerService | null,
	operationsService: OperationsService,
	logger: ILogger,
	csrfConfig: CsrfRuntimeConfig,
	rabbitmq: RabbitMQProvider | null = null,
	redis: RedisProvider | null = null
): (req: FastifyRequest<any>, reply: FastifyReply<any>) => Promise<void> {
	const requiresIdempotency = MUTATIVE_METHODS.has(endpoint.method) && endpoint.options?.skipIdempotency !== true;
	const shouldEnqueue = MUTATIVE_METHODS.has(endpoint.method) && endpoint.options?.enqueue === true && rabbitmq !== null;
	const rl = resolveRateLimit(endpoint);
	const rlTtlSeconds = rl ? Math.max(1, Math.ceil(rl.timeWindow / 1000)) : 0;
	const rlKeyPrefix = rl ? `rl:${endpoint.method}:${endpoint.url}:` : "";

	return async (req: FastifyRequest<any>, reply: FastifyReply<any>) => {
		// ── Rate limiting (Redis INCR + EXPIRE) ─────────────────────────
		if (rl && redis) {
			const key = rlKeyPrefix + req.ip;
			const count = await redis.incr(key);
			if (count === 1) await redis.expire(key, rlTtlSeconds);

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

		// Construir EndpointCtx
		const ctx: EndpointCtx<any, any> = {
			params: (req.params as Record<string, string>) || {},
			query: (req.query as Record<string, string | undefined>) || {},
			data: req.body,
			user,
			token,
			cookies: ((req as any).cookies as Record<string, string | undefined>) || {},
			headers: req.headers as Record<string, string | undefined>,
			ip: req.ip,
		};

		try {
			validateCsrf(endpoint, req, tokenInfo.source, csrfConfig);

			let result: unknown;

			if (requiresIdempotency) {
				const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

				if (!idempotencyKey) {
					throw new IdempotencyError(400, "IDEMPOTENCY_KEY_MISSING", "Header Idempotency-Key is required for this operation");
				}

				const cmd = `${endpoint.method}:${endpoint.url}`;

				if (shouldEnqueue && redis) {
					// ── Enqueue path: always respond 202 ──────────────────────────
					result = await operationsService.httpCheck(cmd, idempotencyKey, async () => {
						const jobId = crypto.randomUUID();

						// Persist job status in Redis
						const jobData = JSON.stringify({
							status: "queued",
							endpoint: `${endpoint.method}:${endpoint.url}`,
							userId: ctx.user?.id,
							createdAt: new Date().toISOString(),
						});
						await redis.setex(`job:${jobId}`, JOB_TTL_SECONDS, jobData);

						// Store token in Redis (not in the queue) so consumer can verify session
						let tokenHash = "";
						if (token) {
							tokenHash = createHash("sha256").update(token).digest("hex");
							await redis.setex(`job-token:${jobId}`, JOB_TTL_SECONDS, token);
						}

						// Publish minimal payload to RabbitMQ
						await rabbitmq.publish(
							endpoint.ownerName,
							endpoint.methodName,
							{
								jobId,
								endpoint: `${endpoint.method}:${endpoint.url}`,
								methodName: endpoint.methodName,
								params: ctx.params,
								data: ctx.data,
								userId: ctx.user?.id,
								orgId: ctx.user?.orgId,
							},
							{
								"x-idempotency-key": idempotencyKey,
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

				// ── Synchronous path (default for mutative endpoints) ─────────
				result = await operationsService.httpCheck(cmd, idempotencyKey, () => endpoint.handler(ctx));
			} else {
				result = await endpoint.handler(ctx);
			}

			// El handler devuelve datos, nosotros manejamos la respuesta HTTP
			if (result === undefined || result === null) {
				reply.status(204).send();
			} else {
				reply.status(200).send(result);
			}
		} catch (error: any) {
			// Capturar UncommonResponse para respuestas especiales (cookies, redirects)
			if (error instanceof UncommonResponse) {
				const rep = reply as any;
				// Establecer cookies
				for (const cookie of error.cookies) {
					rep.setCookie(cookie.name, cookie.value, cookie.options || {});
				}
				// Limpiar cookies
				for (const cookie of error.clearCookies) {
					rep.clearCookie(cookie.name, cookie.options || {});
				}
				// Establecer headers custom
				for (const [name, value] of Object.entries(error.headers)) {
					reply.header(name, value);
				}
				// Redirect o JSON
				if (error.type === "redirect") {
					reply.status(error.status).redirect(error.redirectUrl!);
				} else {
					reply.status(error.status).send(error.body);
				}
				return;
			}

			// Capturar ADCCustomError (HttpError, IdempotencyError y otros) para errores de negocio
			else if (error instanceof ADCCustomError) {
				reply.status(error.status).send(error.toJSON());
				return;
			}

			// Error inesperado
			logger.logError(`Error en endpoint ${endpoint.method} ${endpoint.url}: ${error.message}`);

			reply.status(500).send({
				error: "INTERNAL_ERROR",
				message: process.env.NODE_ENV === "development" ? error.message : "Error interno del servidor",
			});
		}
	};
}
