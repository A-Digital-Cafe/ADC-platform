import type { Connection } from "rabbitmq-client";
import type { TopologyOptions, RabbitMQProviderConfig } from "../types.js";

/**
 * Declara una cola traduciendo el único fallo que no es un bug sino una migración pendiente.
 *
 * Redeclarar una cola con un `x-queue-type` distinto del que tiene devuelve un `PRECONDITION_FAILED`
 * de AMQP que menciona `inequivalent arg 'x-queue-type'` y nada más. Sin este envoltorio, cambiar
 * `RABBITMQ_QUEUE_TYPE` se manifiesta como un consumidor que no arranca por un motivo que hay que ir
 * a buscar al protocolo — y el arreglo (borrar una cola vacía) parece mucho más grave de lo que es.
 */
async function declareQueue(conn: Connection, queue: string, args: Record<string, unknown>): Promise<void> {
	try {
		await conn.queueDeclare({ queue, durable: true, arguments: args });
	} catch (error) {
		const message = (error as Error).message ?? "";
		if (!/PRECONDITION[_ -]FAILED|inequivalent/i.test(message)) throw error;
		const wanted = args["x-queue-type"] === "quorum" ? "quorum" : "classic";
		// `--if-empty` sólo se ofrece cuando la existente es classic (o sea, cuando se pide quorum):
		// las quorum **no soportan ese flag** y sugerirlo mandaría a un comando que falla con un error
		// distinto, que es la peor forma de terminar de leer un mensaje de ayuda.
		const howTo =
			wanted === "quorum"
				? `rabbitmqctl delete_queue ${queue} --if-empty — el flag es lo que evita el accidente: si quedan mensajes se niega, y hay que consumirlos antes`
				: `comprobá que esté vacía (rabbitmqctl list_queues name messages) y borrala con rabbitmqctl delete_queue ${queue}; las colas quorum no admiten --if-empty`;
		throw new Error(
			`La cola '${queue}' ya existe con otro tipo y el broker no permite cambiarlo en sitio (se pidió '${wanted}'). ` +
				`Para que se declare de nuevo, borrala en el broker: ${howTo}. Original: ${message}`,
			{ cause: error }
		);
	}
}

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
	 * Tipo de cola. **`quorum` por defecto, incluso con un broker de un nodo.**
	 *
	 * No por redundancia —un grupo Raft de un miembro no protege de nada— sino por el camino: una
	 * cola quorum **gana réplicas en caliente** al clusterizar el broker (`rabbitmq-queues grow`),
	 * mientras que una classic hay que borrarla y redeclararla. El precio con un nodo es el log Raft
	 * por cola, que a esta escala es ruido. `RABBITMQ_QUEUE_TYPE=classic` vuelve al comportamiento
	 * anterior.
	 *
	 * ⚠️ **El tipo de una cola no se puede cambiar en sitio**: redeclararla con otro tipo falla con
	 * `PRECONDITION_FAILED` y el consumidor no arranca ({@link declareQueue} traduce ese error).
	 * Migrar es drenar, borrar las colas `q.<servicio>.*` y dejar que se declaren de nuevo, en
	 * ventana de mantenimiento. Las colas de retry **se quedan classic** (ver abajo).
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
	await declareQueue(conn, mainQueue, {
		...typeArg,
		"x-dead-letter-exchange": dlxExchange,
		"x-dead-letter-routing-key": operationName,
	});
	await conn.queueBind({ queue: mainQueue, exchange: svcExchange, routingKey: operationName });

	// 3. Dead-letter queue (shared per service, keyed by routing key)
	await declareQueue(conn, dlqQueue, { ...typeArg });
	await conn.queueBind({ queue: dlqQueue, exchange: dlxExchange, routingKey: operationName });

	// 4. Retry queues - one per backoff level
	//    When TTL expires the message is routed BACK to the main exchange/queue.
	for (let level = 0; level < retryDelays.length; level++) {
		const retryQueue = `q.${serviceName}.${operationName}.retry.${level}`;
		await declareQueue(conn, retryQueue, {
			// Las colas de retry se quedan CLASSIC aunque el resto sea quorum: las quorum no
			// soportan `x-message-ttl` a nivel cola, que es justamente el mecanismo del backoff.
			"x-message-ttl": retryDelays[level],
			"x-dead-letter-exchange": svcExchange,
			"x-dead-letter-routing-key": operationName,
		});
		await conn.queueBind({
			queue: retryQueue,
			exchange: retryExchange,
			routingKey: `${operationName}.retry.${level}`,
		});
	}
}
