import type { IHostBasedHttpProvider } from "../../../../interfaces/modules/providers/IHttpServer.js";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { ISessionVerifier } from "@common/types/identity/SessionVerifier.ts";
import type { IOperationsService } from "@common/types/operations/IOperationsService.js";
import type RabbitMQProvider from "../../../../providers/queue/rabbitmq/index.ts";
import type RedisProvider from "../../../../providers/queue/redis/index.ts";
import type { OperationMessage } from "@interfaces/modules/providers/IMessageQueue.js";
import type { Consumer } from "rabbitmq-client";
import { CircuitOpenError } from "@common/types/custom-errors/CircuitOpenError.ts";
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
		const redis = this.#redis;
		const circuitBreaker = operationsService.circuitBreaker;
		const logger = this.#logger;
		const getSessionManager = this.#getSessionManager;
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
			async (msg: OperationMessage) => {
				const {
					jobId,
					params,
					data,
					userId,
					orgId,
					methodName: _method,
				} = msg.body as {
					jobId: string;
					params: Record<string, string>;
					data: unknown;
					userId?: string;
					orgId?: string;
					methodName: string;
				};

				// Update job status → processing
				if (redis && jobId) {
					try {
						const existing = await redis.get(`job:${jobId}`);
						const parsed = safeParseJson(existing, jobStatusCheck);
						if (parsed) {
							parsed.status = "processing";
							await redis.setex(`job:${jobId}`, JobManager.JOB_TTL_SECONDS, JSON.stringify(parsed));
						}
					} catch {
						/* non-critical */
					}
				}

				// ── Retrieve + verify session token from Redis ──────────────────
				let verifiedToken: string | null = null;
				if (redis && jobId) {
					try {
						const storedToken = await redis.get(`job-token:${jobId}`);
						if (storedToken) {
							// Verify hash matches the one sent in the AMQP header
							const expectedHash = msg.headers["x-token-hash"];
							const actualHash = createHash("sha256").update(storedToken).digest("hex");
							if (expectedHash && actualHash === expectedHash) {
								// Verify the session is still valid
								const sessionMgr = getSessionManager();
								if (sessionMgr) {
									const result = await sessionMgr.verifyToken(storedToken);
									if (result.valid) {
										verifiedToken = storedToken;
									} else {
										// Session revoked/expired → DROP, don't process
										logger.logError(`[EndpointManager] ${consumerKey}: session expired/revoked for job ${jobId}, dropping`);
										if (redis) {
											const jobData: JobStatus = {
												status: "failed",
												endpoint: `${endpoint.method}:${endpoint.url}`,
												userId,
												error: "Session expired or revoked",
												createdAt: new Date().toISOString(),
											};
											await redis.setex(`job:${jobId}`, JobManager.JOB_TTL_SECONDS, JSON.stringify(jobData));
											await redis.del(`job-token:${jobId}`);
										}
										return; // ACK without processing
									}
								}
							}
						}
					} catch {
						/* non-critical: proceed without token */
					}
				}

				// Reconstruct minimal EndpointCtx - permissions already verified at HTTP level
				const ctx = {
					params: params || {},
					query: {},
					data,
					user: userId ? { id: userId, username: "", permissions: [], orgId } : null,
					token: verifiedToken,
					cookies: {},
					headers: {},
					ip: "queue-worker",
				};

				// Read stepper resume index from retry headers
				const stepperIdx = msg.headers["x-stepper-idx"] ? Number.parseInt(msg.headers["x-stepper-idx"], 10) : undefined;
				if (stepperIdx !== undefined) {
					(ctx as any)._stepperResumeIdx = stepperIdx;
				}

				try {
					// Execute under circuit breaker
					const result = await circuitBreaker.execute(consumerKey, () => endpoint.handler(ctx as any));

					// Update job status → completed
					if (redis && jobId) {
						try {
							const jobData: JobStatus = {
								status: "completed",
								endpoint: `${endpoint.method}:${endpoint.url}`,
								userId,
								result,
								createdAt: new Date().toISOString(),
								completedAt: new Date().toISOString(),
							};
							await redis.setex(`job:${jobId}`, JobManager.JOB_TTL_SECONDS, JSON.stringify(jobData));
							await redis.del(`job-token:${jobId}`);
						} catch {
							/* non-critical */
						}
					}
				} catch (error: any) {
					// Update job status → failed
					if (redis && jobId) {
						try {
							const jobData: JobStatus = {
								status: "failed",
								endpoint: `${endpoint.method}:${endpoint.url}`,
								userId,
								error: error.message,
								createdAt: new Date().toISOString(),
							};
							await redis.setex(`job:${jobId}`, JobManager.JOB_TTL_SECONDS, JSON.stringify(jobData));
						} catch {
							/* non-critical */
						}
					}

					// Propagate stepper index if available (for retry queue headers)
					if (error.failedStep !== undefined || error instanceof CircuitOpenError) {
						throw error; // consumer wrapper in rabbitmq provider handles retry logic
					}
					throw error;
				}
			},
			{
				prefetch: queueOpts?.prefetch,
				concurrency: queueOpts?.concurrency,
				jobTimeoutMs: queueOpts?.jobTimeoutMs,
			}
		);

		this.#consumers.set(consumerKey, consumer);
		logger.logOk(`[EndpointManager] consumer set up: ${consumerKey}`);
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
