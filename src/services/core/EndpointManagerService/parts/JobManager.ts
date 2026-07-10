import type { IHostBasedHttpProvider } from "../../../../interfaces/modules/providers/IHttpServer.js";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { ISessionVerifier } from "@common/types/identity/SessionVerifier.ts";
import type { IOperationsService } from "@common/types/operations/IOperationsService.js";
import type RabbitMQProvider from "../../../../providers/queue/rabbitmq/index.ts";
import type RedisProvider from "../../../../providers/queue/redis/index.ts";
import type { OperationMessage } from "@interfaces/modules/providers/IMessageQueue.js";
import type { Consumer } from "rabbitmq-client";
import { createHash } from "node:crypto";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { jobStatusCheck } from "../schemas/job-status.js";
import type { EndpointHandler, HttpMethod, JobStatus } from "../types.js";

interface ConsumerEndpoint {
	handler: EndpointHandler<any, any, any>;
	method: HttpMethod;
	url: string;
}

interface QueueOptions {
	prefetch?: number;
	concurrency?: number;
	maxRetries?: number;
	jobTimeoutMs?: number;
}

interface JobManagerDeps {
	logger: ILogger;
	getSessionManager: () => ISessionVerifier | null;
	operationsService: IOperationsService;
	rabbitmq: RabbitMQProvider | null;
	redis: RedisProvider | null;
	httpProvider: IHostBasedHttpProvider | null;
}

/** Manages queue consumers and the job polling endpoint. */
export class JobManager {
	static readonly JOB_TTL_SECONDS = 600; // 10 min

	readonly #logger: ILogger;
	readonly #getSessionManager: () => ISessionVerifier | null;

	#rabbitmq: RabbitMQProvider | null;
	#redis: RedisProvider | null;
	readonly #consumers: Map<string, Consumer> = new Map();

	constructor(deps: JobManagerDeps) {
		this.#logger = deps.logger;
		this.#getSessionManager = deps.getSessionManager;
		this.#rabbitmq = deps.rabbitmq;
		this.#redis = deps.redis;
	}

	// ─── Public API ──────────────────────────────────────────────────────────────

	/**
	 * Registers GET /api/jobs/:jobId for polling async job results.
	 */
	registerJobEndpoint(httpProvider: IHostBasedHttpProvider): void {
		if (!this.#redis) return;

		const redis = this.#redis;

		httpProvider.registerRoute("GET", "/api/jobs/:jobId", async (req: any, reply: any) => {
			const { jobId } = req.params as { jobId: string };
			if (!jobId) {
				reply.status(400).send({ error: "MISSING_JOB_ID", message: "jobId is required" });
				return;
			}

			const raw = await redis.get(`job:${jobId}`);
			if (!raw) {
				reply.status(404).send({ error: "JOB_NOT_FOUND", message: "Job not found or expired" });
				return;
			}

			const job = safeParseJson(raw, jobStatusCheck);
			if (!job) {
				reply.status(404).send({ error: "JOB_NOT_FOUND", message: "Job not found or expired" });
				return;
			}
			reply.status(200).send(job);
		});

		this.#logger.logDebug("[EndpointManager] registered GET /api/jobs/:jobId");
	}

	/**
	 * Declares topology and creates a consumer for an enqueued endpoint.
	 * The consumer reconstructs a minimal context and executes the handler
	 * under circuit breaker protection.
	 */
	async setupConsumer(
		serviceName: string,
		methodName: string,
		endpoint: ConsumerEndpoint,
		operationsService: IOperationsService,
		queueOpts?: QueueOptions
	): Promise<void> {
		const rabbitmq = this.#rabbitmq!;
		const consumerKey = `${serviceName}.${methodName}`;

		// Declare topology once per service
		await rabbitmq.declareOperationTopology(serviceName, methodName, {
			prefetch: queueOpts?.prefetch,
			concurrency: queueOpts?.concurrency,
			maxRetries: queueOpts?.maxRetries,
		});

		// Create consumer that processes queued jobs
		const consumer = rabbitmq.createOperationConsumer(
			serviceName,
			methodName,
			(msg: OperationMessage) => this.#consumeJob(msg, endpoint, operationsService, consumerKey),
			{
				prefetch: queueOpts?.prefetch,
				concurrency: queueOpts?.concurrency,
				jobTimeoutMs: queueOpts?.jobTimeoutMs,
			}
		);

		this.#consumers.set(consumerKey, consumer);
		this.#logger.logOk(`[EndpointManager] consumer set up: ${consumerKey}`);
	}

	// ─── Consumo de jobs encolados ────────────────────────────────────────────────

	/** Cuerpo del mensaje AMQP de un job encolado. */
	#jobBody(msg: OperationMessage) {
		return msg.body as {
			jobId: string;
			params: Record<string, string>;
			data: unknown;
			userId?: string;
			orgId?: string;
			methodName: string;
		};
	}

	/**
	 * Procesa un job encolado: marca `processing`, verifica el token de sesión
	 * (drop si la sesión fue revocada), ejecuta el handler bajo circuit breaker
	 * y persiste el resultado (`completed`/`failed`) en Redis.
	 */
	async #consumeJob(
		msg: OperationMessage,
		endpoint: ConsumerEndpoint,
		operationsService: IOperationsService,
		consumerKey: string
	): Promise<void> {
		const body = this.#jobBody(msg);
		const { jobId, userId } = body;
		const endpointLabel = `${endpoint.method}:${endpoint.url}`;

		await this.#markJobProcessing(jobId);

		const verification = await this.#verifyJobToken(msg, jobId, userId, endpointLabel, consumerKey);
		if (verification.drop) return; // ACK sin procesar (sesión revocada/expirada)

		const ctx = JobManager.#buildConsumerCtx(body, verification.token, msg.headers);

		try {
			// Execute under circuit breaker
			const result = await operationsService.circuitBreaker.execute(consumerKey, () => endpoint.handler(ctx as any));
			await this.#storeJobStatus(
				jobId,
				{
					status: "completed",
					endpoint: endpointLabel,
					userId,
					result,
					createdAt: new Date().toISOString(),
					completedAt: new Date().toISOString(),
				},
				true
			);
		} catch (error: any) {
			await this.#storeJobStatus(
				jobId,
				{
					status: "failed",
					endpoint: endpointLabel,
					userId,
					error: error.message,
					createdAt: new Date().toISOString(),
				},
				false
			);
			// El wrapper del consumer en el provider de rabbitmq maneja la lógica de
			// retry (incluye el índice de stepper y CircuitOpenError).
			throw error;
		}
	}

	/** Marca el job como `processing` en Redis (best-effort, no crítico). */
	async #markJobProcessing(jobId: string): Promise<void> {
		if (!this.#redis || !jobId) return;
		try {
			const existing = await this.#redis.get(`job:${jobId}`);
			const parsed = safeParseJson(existing, jobStatusCheck);
			if (parsed) {
				parsed.status = "processing";
				await this.#redis.setex(`job:${jobId}`, JobManager.JOB_TTL_SECONDS, JSON.stringify(parsed));
			}
		} catch {
			/* non-critical */
		}
	}

	/** Persiste el estado final del job (best-effort); opcionalmente borra el token guardado. */
	async #storeJobStatus(jobId: string, jobData: JobStatus, deleteToken: boolean): Promise<void> {
		if (!this.#redis || !jobId) return;
		try {
			await this.#redis.setex(`job:${jobId}`, JobManager.JOB_TTL_SECONDS, JSON.stringify(jobData));
			if (deleteToken) await this.#redis.del(`job-token:${jobId}`);
		} catch {
			/* non-critical */
		}
	}

	/**
	 * Recupera y verifica el token de sesión del job desde Redis: el hash debe
	 * coincidir con el header AMQP y la sesión seguir válida. Si la sesión fue
	 * revocada/expirada, marca el job como fallido y pide DROP. Cualquier error
	 * de infraestructura degrada a "procesar sin token".
	 */
	async #verifyJobToken(
		msg: OperationMessage,
		jobId: string,
		userId: string | undefined,
		endpointLabel: string,
		consumerKey: string
	): Promise<{ token: string | null; drop: boolean }> {
		const redis = this.#redis;
		const noToken = { token: null, drop: false };
		if (!redis || !jobId) return noToken;
		try {
			const storedToken = await redis.get(`job-token:${jobId}`);
			if (!storedToken) return noToken;

			// Verify hash matches the one sent in the AMQP header
			const expectedHash = msg.headers["x-token-hash"];
			const actualHash = createHash("sha256").update(storedToken).digest("hex");
			if (!expectedHash || actualHash !== expectedHash) return noToken;

			// Verify the session is still valid
			const sessionMgr = this.#getSessionManager();
			if (!sessionMgr) return noToken;
			const result = await sessionMgr.verifyToken(storedToken);
			if (result.valid) return { token: storedToken, drop: false };

			// Session revoked/expired → DROP, don't process
			this.#logger.logError(`[EndpointManager] ${consumerKey}: session expired/revoked for job ${jobId}, dropping`);
			const jobData: JobStatus = {
				status: "failed",
				endpoint: endpointLabel,
				userId,
				error: "Session expired or revoked",
				createdAt: new Date().toISOString(),
			};
			await redis.setex(`job:${jobId}`, JobManager.JOB_TTL_SECONDS, JSON.stringify(jobData));
			await redis.del(`job-token:${jobId}`);
			return { token: null, drop: true };
		} catch {
			/* non-critical: proceed without token */
			return noToken;
		}
	}

	/** Reconstruye el EndpointCtx mínimo (los permisos ya se verificaron a nivel HTTP). */
	static #buildConsumerCtx(
		body: { jobId: string; params: Record<string, string>; data: unknown; userId?: string; orgId?: string },
		verifiedToken: string | null,
		headers: OperationMessage["headers"]
	) {
		const ctx = {
			params: body.params || {},
			query: {},
			data: body.data,
			user: body.userId ? { id: body.userId, username: "", permissions: [], orgId: body.orgId } : null,
			token: verifiedToken,
			cookies: {},
			headers: {},
			ip: "queue-worker",
		};

		// Read stepper resume index from retry headers
		const stepperIdx = headers["x-stepper-idx"] ? Number.parseInt(headers["x-stepper-idx"], 10) : undefined;
		if (stepperIdx !== undefined) {
			(ctx as any)._stepperResumeIdx = stepperIdx;
		}
		return ctx;
	}

	/**
	 * Gracefully drains all consumers and clears internal state.
	 */
	async shutdown(): Promise<void> {
		const drainPromises: Promise<void>[] = [];
		for (const [key, consumer] of this.#consumers) {
			this.#logger.logDebug(`[EndpointManager] draining consumer ${key}…`);
			drainPromises.push(consumer.close());
		}
		await Promise.allSettled(drainPromises);
		this.#consumers.clear();
		this.#rabbitmq = null;
		this.#redis = null;
	}

	/** Whether queue infrastructure (RabbitMQ) is available */
	get hasQueue(): boolean {
		return this.#rabbitmq !== null;
	}

	/** Whether Redis is available */
	get hasRedis(): boolean {
		return this.#redis !== null;
	}
}
