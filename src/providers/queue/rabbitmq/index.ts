import { Connection, type Consumer, type Publisher } from "rabbitmq-client";
import { BaseProvider, ProviderType } from "../../BaseProvider.js";
import type { RabbitMQProviderConfig, TopologyOptions, ConsumerOptions, OperationMessage } from "./types.js";
import { declareOperationTopology } from "./helpers/topology.js";
import { publishToExchange, publishToRetryQueue } from "./helpers/publisher.js";
import { createOperationConsumer } from "./helpers/consumer.js";

export type { RabbitMQProviderConfig, TopologyOptions, ConsumerOptions, OperationMessage } from "./types.js";

/**
 * RabbitMQ Provider - AMQP message broker with operation-level topology.
 *
 * Per-operation topology:
 *   exchange  svc.{service}                 (direct)  → main work queue
 *   exchange  retry.{service}               (direct)  → per-level retry queues
 *   exchange  dlx.{service}                 (direct)  → dead-letter queue
 *
 *   queue  q.{service}.{operation}                     (durable, DLX → dlx.{service})
 *   queue  q.{service}.{operation}.retry.{level}       (durable, TTL, DLX → svc.{service})
 *   queue  q.{service}.dlq                             (durable)
 *
 * Retry flow:  main queue → handler fails → publish to retry queue → TTL expires
 *              → DLX routes back to main queue → handler retries.
 * After all retries exhausted → message is DROPped → goes to DLQ via dlx exchange.
 */
export default class RabbitMQProvider extends BaseProvider {
	public readonly name = "rabbitmq";
	public readonly type = ProviderType.QUEUE_PROVIDER;

	#connection: Connection | null = null;
	readonly #config: RabbitMQProviderConfig;
	#publisher: Publisher | null = null;
	readonly #consumers: Map<string, Consumer> = new Map();
	readonly #declaredTopologies: Set<string> = new Set();
	#stopping = false;

	constructor(config?: RabbitMQProviderConfig) {
		super();
		this.#config = config || {};
	}

	// ─── Lifecycle ───────────────────────────────────────────────────────────────

	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		const url = this.#config.url || "amqp://guest:guest@localhost:5672";
		this.#connection = new Connection(url);

		this.#connection.on("error", (err: Error) => {
			if (this.#stopping) {
				this.logger.logDebug(`[RabbitMQ] connection error during shutdown (expected): ${err.message}`);
				return;
			}
			this.logger.logError(`[RabbitMQ] connection error: ${err.message}`);
		});
		this.#connection.on("connection", () => {
			this.logger.logOk("[RabbitMQ] connection established");
		});

		this.#publisher = this.#connection.createPublisher({ confirm: true, maxAttempts: 3 });
		this.logger.logOk(`[RabbitMQ] provider started (${url})`);
	}

	async stop(kernelKey: symbol): Promise<void> {
		this.#stopping = true;
		const drainPromises: Promise<void>[] = [];
		for (const [key, consumer] of this.#consumers) {
			this.logger.logDebug(`[RabbitMQ] draining consumer ${key}…`);
			drainPromises.push(consumer.close());
		}
		await Promise.allSettled(drainPromises);
		this.#consumers.clear();

		if (this.#publisher) {
			await this.#publisher.close();
			this.#publisher = null;
		}
		if (this.#connection) {
			await this.#connection.close();
			this.#connection = null;
		}

		this.#declaredTopologies.clear();
		this.logger.logOk("[RabbitMQ] provider stopped");
		await super.stop(kernelKey);
	}

	// ─── Topology ────────────────────────────────────────────────────────────────

	/**
	 * Declares the full exchange / queue / binding topology for one operation.
	 * Idempotent: skips if already declared in this process session.
	 */
	async declareOperationTopology(serviceName: string, operationName: string, options?: TopologyOptions): Promise<void> {
		const topologyKey = `${serviceName}.${operationName}`;
		if (this.#declaredTopologies.has(topologyKey)) return;

		await declareOperationTopology(this.#requireConnection(), serviceName, operationName, this.#config, options);

		this.#declaredTopologies.add(topologyKey);
		this.logger.logDebug(`[RabbitMQ] topology declared: ${topologyKey}`);
	}

	// ─── Publishing ──────────────────────────────────────────────────────────────

	async publish(
		serviceName: string,
		operationName: string,
		message: Record<string, unknown>,
		headers?: Record<string, string>
	): Promise<void> {
		await publishToExchange(this.#requirePublisher(), serviceName, operationName, message, headers);
	}

	async publishToRetry(
		serviceName: string,
		operationName: string,
		retryLevel: number,
		message: Record<string, unknown>,
		headers: Record<string, string>
	): Promise<void> {
		await publishToRetryQueue(this.#requirePublisher(), serviceName, operationName, retryLevel, message, headers);
	}

	// ─── Consuming ───────────────────────────────────────────────────────────────

	createOperationConsumer(
		serviceName: string,
		operationName: string,
		handler: (msg: OperationMessage) => Promise<void>,
		options?: ConsumerOptions
	): Consumer {
		const consumer = createOperationConsumer(
			{
				connection: this.#requireConnection(),
				publisher: this.#requirePublisher(),
				config: this.#config,
				logger: this.logger,
			},
			serviceName,
			operationName,
			handler,
			options
		);

		this.#consumers.set(`${serviceName}.${operationName}`, consumer);
		this.logger.logDebug(`[RabbitMQ] consumer created: ${serviceName}.${operationName}`);
		return consumer;
	}

	// ─── Internal ────────────────────────────────────────────────────────────────

	#requireConnection(): Connection {
		if (!this.#connection) throw new Error("[RabbitMQ] provider not started");
		return this.#connection;
	}

	#requirePublisher(): Publisher {
		if (!this.#publisher) throw new Error("[RabbitMQ] publisher not available");
		return this.#publisher;
	}

	get connection(): Connection | null {
		return this.#connection;
	}
}
