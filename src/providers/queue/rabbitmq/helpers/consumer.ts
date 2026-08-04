import { ConsumerStatus, type Publisher, type Connection, type Consumer } from "rabbitmq-client";
import type { RabbitMQProviderConfig, ConsumerOptions, OperationMessage } from "../types.js";
import { publishToRetryQueue } from "./publisher.js";
import { isPermanentClientError } from "@common/types/ADCCustomError.js";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";

interface CreateConsumerDeps {
	connection: Connection;
	publisher: Publisher;
	config: RabbitMQProviderConfig;
	logger: ILogger;
}

/**
 * Creates a consumer for a specific operation queue.
 *
 * The provided `handler` is wrapped:
 * - On success → ACK
 * - On retriable failure → ACK current msg + publish to retry queue
 * - On terminal failure (retries exhausted) → DROP (goes to DLQ via DLX)
 */
export function createOperationConsumer(
	deps: CreateConsumerDeps,
	serviceName: string,
	operationName: string,
	handler: (msg: OperationMessage) => Promise<void>,
	options?: ConsumerOptions
): Consumer {
	const { connection, publisher, config, logger } = deps;
	const maxRetries = config.maxRetries ?? 4;
	const retryDelays = config.retryDelaysMs ?? [1000, 5000, 25000, 125000];
	const jobTimeout = options?.jobTimeoutMs ?? 15_000;

	const consumerKey = `${serviceName}.${operationName}`;
	const mainQueue = `q.${serviceName}.${operationName}`;

	const consumer = connection.createConsumer(
		{
			queue: mainQueue,
			queueOptions: { passive: true },
			qos: { prefetchCount: options?.prefetch ?? config.defaultPrefetch ?? 10 },
			concurrency: options?.concurrency ?? config.defaultConcurrency ?? 5,
			requeue: false,
		},
		async (msg: any) => {
			const headers = (msg.headers ?? {}) as Record<string, string>;
			const retryCount = Number.parseInt(headers["x-retry-count"] || "0", 10);
			const body = (typeof msg.body === "object" && msg.body !== null ? msg.body : {}) as Record<string, unknown>;

			const opMsg: OperationMessage = {
				body,
				headers,
				routingKey: msg.routingKey ?? operationName,
			};

			try {
				await Promise.race([
					handler(opMsg),
					new Promise<never>((_, reject) => setTimeout(() => reject(new Error("JOB_TIMEOUT")), jobTimeout)),
				]);
				return ConsumerStatus.ACK;
			} catch (error: any) {
				// Un 4xx tipado no cambia de resultado en el reintento: reintentarlo mantiene la
				// operación fallando durante el backoff y, como cada intento pasa por el
				// circuit breaker, un solo pedido inválido alcanzaba para abrirlo y dejar la
				// operación fuera de servicio para todos los usuarios.
				if (isPermanentClientError(error)) {
					logger.logDebug(`[RabbitMQ] ${consumerKey} sin reintento (${error.status} ${error.errorKey}): ${error.message}`);
					return ConsumerStatus.DROP;
				}

				const nextRetry = retryCount;
				const canRetry = nextRetry < maxRetries && nextRetry < retryDelays.length;

				if (canRetry) {
					const updatedHeaders: Record<string, string> = {
						...headers,
						"x-retry-count": String(nextRetry + 1),
					};
					if (error.failedStep !== undefined) {
						updatedHeaders["x-stepper-idx"] = String(error.failedStep);
					}

					try {
						await publishToRetryQueue(publisher, serviceName, operationName, nextRetry, body, updatedHeaders);
					} catch (publishErr: any) {
						logger.logError(`[RabbitMQ] failed to publish retry for ${consumerKey}: ${publishErr.message}`);
						return ConsumerStatus.DROP;
					}
					return ConsumerStatus.ACK;
				}

				logger.logError(`[RabbitMQ] ${consumerKey} retries exhausted (${retryCount}/${maxRetries}): ${error.message}`);
				return ConsumerStatus.DROP;
			}
		}
	);

	consumer.on("error", (err: Error) => {
		logger.logError(`[RabbitMQ] consumer ${consumerKey} error: ${err.message}`);
	});

	return consumer;
}
