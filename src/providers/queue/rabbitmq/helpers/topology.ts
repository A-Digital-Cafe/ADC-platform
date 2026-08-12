import type { Connection } from "rabbitmq-client";
import type { TopologyOptions, RabbitMQProviderConfig } from "../types.js";

/**
 * Declares the full exchange / queue / binding topology for one operation.
 *
 * Exchanges:
 *   svc.{service}   (direct) → main work queue
 *   retry.{service}  (direct) → per-level retry queues
 *   dlx.{service}    (direct) → dead-letter queue
 *
 * Queues:
 *   q.{service}.{operation}                  (durable, DLX → dlx.{service})
 *   q.{service}.{operation}.retry.{level}    (durable, TTL, DLX → svc.{service})
 *   q.{service}.dlq                          (durable)
 */
export async function declareOperationTopology(
	conn: Connection,
	serviceName: string,
	operationName: string,
	config: RabbitMQProviderConfig,
	options?: TopologyOptions
): Promise<void> {
	const retryDelays = options?.retryDelaysMs ?? config.retryDelaysMs ?? [1000, 5000, 25000, 125000];

	/**
	 * Tipo de cola. `classic` por defecto: con un broker de un nodo, `quorum` no aporta nada y
	 * cuesta memoria y latencia. Con un clúster sí es lo correcto (las colas espejadas están
	 * deprecadas), y entonces se pone `RABBITMQ_QUEUE_TYPE=quorum`.
	 *
	 * ⚠️ **El tipo de una cola no se puede cambiar en sitio.** Redeclarar una cola existente con
	 * otro tipo falla con `PRECONDITION_FAILED` y el consumidor no arranca. Migrar es: drenar,
	 * borrar las colas `q.<servicio>.*` y dejar que se declaren de nuevo — en ventana de
	 * mantenimiento, no en caliente. El retry por TTL+DLX sigue funcionando igual con quorum.
	 */
	const typeArg = config.queueType === "quorum" ? ({ "x-queue-type": "quorum" } as const) : {};

	const svcExchange = `svc.${serviceName}`;
	const retryExchange = `retry.${serviceName}`;
	const dlxExchange = `dlx.${serviceName}`;
	const mainQueue = `q.${serviceName}.${operationName}`;
	const dlqQueue = `q.${serviceName}.dlq`;

	// 1. Exchanges
	await conn.exchangeDeclare({ exchange: svcExchange, type: "direct", durable: true });
	await conn.exchangeDeclare({ exchange: retryExchange, type: "direct", durable: true });
	await conn.exchangeDeclare({ exchange: dlxExchange, type: "direct", durable: true });

	// 2. Main work queue → messages rejected (DROP) go to DLX
	await conn.queueDeclare({
		queue: mainQueue,
		durable: true,
		arguments: {
			...typeArg,
			"x-dead-letter-exchange": dlxExchange,
			"x-dead-letter-routing-key": operationName,
		},
	});
	await conn.queueBind({ queue: mainQueue, exchange: svcExchange, routingKey: operationName });

	// 3. Dead-letter queue (shared per service, keyed by routing key)
	await conn.queueDeclare({ queue: dlqQueue, durable: true, arguments: { ...typeArg } });
	await conn.queueBind({ queue: dlqQueue, exchange: dlxExchange, routingKey: operationName });

	// 4. Retry queues - one per backoff level
	//    When TTL expires the message is routed BACK to the main exchange/queue.
	for (let level = 0; level < retryDelays.length; level++) {
		const retryQueue = `q.${serviceName}.${operationName}.retry.${level}`;
		await conn.queueDeclare({
			queue: retryQueue,
			durable: true,
			arguments: {
				// Las colas de retry se quedan CLASSIC aunque el resto sea quorum: las quorum no
				// soportan `x-message-ttl` a nivel cola, que es justamente el mecanismo del backoff.
				"x-message-ttl": retryDelays[level],
				"x-dead-letter-exchange": svcExchange,
				"x-dead-letter-routing-key": operationName,
			},
		});
		await conn.queueBind({
			queue: retryQueue,
			exchange: retryExchange,
			routingKey: `${operationName}.retry.${level}`,
		});
	}
}
