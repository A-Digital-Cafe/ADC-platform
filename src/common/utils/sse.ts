import type { RawResponseSink } from "./http-stream.ts";

/**
 * Transporte SSE sobre el socket crudo (`reply.hijack()`).
 *
 * Los streams long-lived no pueden pasar por el flujo normal de `@RegisterEndpoint`, que
 * bufferiza la respuesta (gotcha de Bun con `reply.send(Readable)`), así que cada uno
 * hijackeaba el socket y escribía sus propios headers a mano. Estaba duplicado entre la
 * campana de notificaciones y el túnel de dispositivos de Drive, con dos copias del mismo
 * bloque de headers, del mismo objeto conexión y de la misma cadencia de heartbeat. Acá vive
 * una sola vez; lo que legítimamente difiere —cómo cada servicio indexa sus conexiones y qué
 * eventos emite— se queda en su hub.
 *
 * `@common` no puede depender de Fastify, así que los tipos son estructurales.
 */

/** @public Conexión SSE viva. El hub sólo ve esto; no conoce Fastify ni el socket. */
export interface SseConnection {
	/** Escribe un bloque ya formateado en el stream. */
	send: (chunk: string) => void;
	/** Cierra el stream. */
	close: () => void;
}

/** Cadencia del comentario de keep-alive. Por debajo del timeout de inactividad de los proxies. */
const SSE_HEARTBEAT_MS = 25_000;

/** @public Comentario SSE de keep-alive: no llega como evento al `EventSource`, sólo mantiene vivo el socket. */
export const SSE_PING = ": ping\n\n";

/** @public Serializa un evento al formato del wire (`data: <json>\n\n`). */
export function sseEvent(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Headers de un stream SSE. `X-Accel-Buffering` desactiva el buffering de nginx, sin el cual
 * el proxy retiene los eventos hasta llenar su buffer y el stream parece colgado.
 */
function sseHeaders(extra?: Record<string, string>): Record<string, string> {
	return {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no",
		...extra,
	};
}

/** @public Superficie mínima del request crudo: sólo hace falta enterarse de que el cliente cerró. */
export interface RawRequestSource {
	on: (event: string, listener: () => void) => void;
}

/**
 * Toma el socket, abre el stream SSE y devuelve la conexión.
 *
 * `onClose` corre **una sola vez**, dispare `close` o `error`: sin la guarda, un cliente que
 * corta a mitad emite los dos y el disposer del hub se ejecuta dos veces.
 *
 * Tras esto Fastify ya no administra la respuesta: todo lo que pueda fallar (autenticación,
 * resolución del dispositivo) tiene que haberse validado ANTES.
 * @public
 */
export function openSseStream(
	raw: RawResponseSink,
	request: RawRequestSource,
	options: { headers?: Record<string, string>; onClose: () => void }
): SseConnection {
	raw.writeHead(200, sseHeaders(options.headers));
	raw.write(":\n\n"); // abre el stream: fuerza el flush de los headers

	const conn: SseConnection = {
		send: (chunk: string) => {
			raw.write(chunk);
		},
		close: () => {
			try {
				raw.end();
			} catch {
				/* el socket ya estaba cerrado */
			}
		},
	};

	let closed = false;
	const cleanup = () => {
		if (closed) return;
		closed = true;
		options.onClose();
		conn.close();
	};
	request.on("close", cleanup);
	request.on("error", cleanup);

	return conn;
}

/**
 * Heartbeat compartido de un hub: un solo timer para todas sus conexiones.
 *
 * `unref` para que no sostenga el proceso vivo — un intervalo referenciado deja al kernel sin
 * poder salir aunque no quede ninguna conexión.
 * @public
 */
export class SseHeartbeat {
	#timer: ReturnType<typeof setInterval> | null;

	constructor(ping: () => void, intervalMs: number = SSE_HEARTBEAT_MS) {
		this.#timer = setInterval(ping, intervalMs);
		this.#timer.unref?.();
	}

	stop(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}
}
