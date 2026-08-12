import type { Connection, Consumer, Publisher } from "rabbitmq-client";

/**
 * Fan-out entre nodos: **topología distinta** a la de las colas de trabajo del provider.
 *
 * Las colas de operación son durables, con reintentos y DLQ, porque su mensaje NO se puede perder.
 * Esto es lo contrario: un aviso efímero entre procesos vivos ("invalidá esa caché", "esta
 * notificación es para un usuario que quizá esté conectado a vos"). Guardarlo sería peor —
 * un nodo que arranca no quiere reproducir invalidaciones de hace una hora—, así que:
 *
 * - exchange `fanout` **no durable**: se recrea al arrancar y no sobrevive al broker,
 * - una cola **exclusiva y auto-delete por nodo**: nace y muere con la conexión,
 * - sin reintentos ni DLQ: si el nodo no estaba, el aviso no le corresponde.
 */

/** Declara el exchange de fan-out y devuelve el publisher. No durable a propósito. */
export function createFanoutPublisher(connection: Connection, exchange: string): Publisher {
	return connection.createPublisher({
		// Sin confirms: un aviso efímero no justifica esperar el ack del broker en el camino
		// caliente (una invalidación de caché no se reintenta, se vuelve a emitir sola).
		confirm: false,
		exchanges: [{ exchange, type: "fanout", durable: false, autoDelete: false }],
	});
}

/** Emite a todos los nodos suscritos. Sin `routingKey`: en un fanout se ignora. */
export async function publishFanout(publisher: Publisher, exchange: string, message: Record<string, unknown>): Promise<void> {
	await publisher.send({ exchange, routingKey: "", durable: false }, message);
}

/**
 * Consume el fan-out con una cola propia de este nodo.
 *
 * `exclusive` + `autoDelete` es lo que hace que un nodo que se cae no deje una cola creciendo en
 * el broker para siempre: RabbitMQ la borra al cerrarse la conexión.
 */
export function createFanoutConsumer(
	connection: Connection,
	exchange: string,
	queue: string,
	handler: (body: unknown) => Promise<void>
): Consumer {
	return connection.createConsumer(
		{
			queue,
			queueOptions: { exclusive: true, autoDelete: true, durable: false },
			exchanges: [{ exchange, type: "fanout", durable: false, autoDelete: false }],
			queueBindings: [{ exchange, routingKey: "" }],
			qos: { prefetchCount: 32 },
			requeue: false,
		},
		async (msg: { body: unknown }) => {
			await handler(msg.body);
		}
	);
}
