import type { OutgoingHttpHeaders } from "node:http";
import type { Readable } from "node:stream";

/**
 * Superficie mínima de una respuesta cruda. Estructural a propósito: sirve para el
 * `ServerResponse` de Node y para los wrappers de los presets (`RawResponse` del túnel de Drive).
 */
export interface RawResponseSink {
	writeHead: (status: number, headers: any) => void;
	write: (chunk: any) => boolean;
	end: (chunk?: any) => void;
	destroy?: () => void;
	on: (event: string, listener: (...args: any[]) => void) => void;
}

/**
 * Bombea un `Readable` al socket crudo (`reply.hijack()`) honrando backpressure, aborto del
 * cliente y cierre único.
 *
 * Existe porque en Bun `reply.send(Readable)` tras un request HTTP saliente (leer de S3 para
 * descifrar al vuelo) entrega 0 bytes, y bufferizar a un `Buffer` materializaba el archivo entero
 * en el heap.
 *
 * Tras `hijack()` Fastify ya no administra la respuesta: no se puede mandar un JSON de error
 * después, así que el llamador debe validar cuanto pueda fallar ANTES de invocar esto.
 */
export function pipeStreamToRaw(
	stream: Readable,
	raw: RawResponseSink,
	status: number,
	headers: OutgoingHttpHeaders,
	onError?: (error: unknown) => void
): void {
	let finished = false;
	const finish = (destroy: boolean, error?: unknown): void => {
		if (finished) return;
		finished = true;
		stream.destroy();
		// `destroy` es opcional en los wrappers de los presets; sin él, cerrar es lo mejor disponible.
		if (destroy && raw.destroy) raw.destroy();
		else raw.end();
		if (error !== undefined) onError?.(error);
	};

	raw.writeHead(status, headers);

	stream.on("data", (chunk: Buffer | string) => {
		// `write` devuelve false cuando el buffer interno se llenó: pausar hasta el drain.
		if (!raw.write(chunk)) stream.pause();
	});
	raw.on("drain", () => stream.resume());

	stream.on("end", () => finish(false));
	stream.on("error", (error) => finish(true, error));
	// El cliente cortó (cerró la pestaña, canceló la descarga): liberar el origen.
	raw.on("close", () => finish(true));
}
