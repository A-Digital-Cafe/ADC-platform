import type { IncomingMessage } from "node:http";
import { Transform } from "node:stream";
import type { FastifyRequest } from "fastify";
import { getRawBodyLimitBytes } from "../security/index.js";

/** Error 413 para el techo de bodies binarios crudos (Fastify usa `statusCode` del error). */
function rawBodyTooLarge(message: string): Error & { statusCode: number } {
	return Object.assign(new Error(message), { statusCode: 413 });
}

/**
 * Parser de binarios crudos: sin bufferizar (`request.body` sigue siendo un Readable). Fastify no
 * aplica `bodyLimit` a los parsers con firma de stream, así que el techo anti-abuso lo pone este
 * wrapper: atajo por Content-Length + contador real, porque un cliente puede mandar chunked o
 * declarar cualquier cosa. El tope por plan lo sigue poniendo cada consumidor (ej. el túnel de
 * Drive); esto sólo evita el caso "subida infinita".
 *
 * El `pipe` es eager a propósito y así se queda. Se lo acusó de dejar las subidas grandes en cero
 * bytes cuando el handler hace `await` antes de leer el stream: es falso, y el banco que lo
 * "probó" usaba como cliente el `node:http` de Bun, que es justamente lo que está roto. Medido con
 * curl contra este mismo parser (Bun 1.3.14, 4 MB): 4194304 bytes en las cuatro combinaciones —con
 * y sin `await` de I/O, con Content-Length y chunked— y el techo cortando con 413 por ambos
 * caminos. Lo que se colgaba era el tramo SALIENTE de los proxies: el `ClientRequest` de Bun nunca
 * emite `drain` ni mueve `writableLength`/`socket.bytesWritten`, así que un `pipeline` hacia el
 * upstream se frenaba para siempre pasado ~1 MiB (por eso `@common/utils/http-proxy.ts` sale por
 * `fetch`). Volver esto perezoso (arrancar el pipe recién en el primer `read`) no arreglaba
 * aquello —se midió: seguía colgado— y sólo agrega superficie donde hoy no falta nada. El cuerpo
 * sí se pierde, en cambio, si el handler vuelve sin `reply.hijack()` ni responder: ahí el server
 * lo descarta y contesta 200 solo.
 */
export function rawStreamParser(request: FastifyRequest, payload: IncomingMessage, done: (err: Error | null, body?: unknown) => void): void {
	const max = getRawBodyLimitBytes();
	const declared = Number(request.headers["content-length"]);
	if (Number.isFinite(declared) && declared > max) {
		done(rawBodyTooLarge(`Body binario de ${declared} bytes: supera el techo de ${max}`), undefined);
		return;
	}

	let seen = 0;
	const limiter = new Transform({
		transform(chunk: Buffer, _enc, cb) {
			seen += chunk.length;
			if (seen > max) {
				cb(rawBodyTooLarge(`Body binario supera el techo de ${max} bytes`));
				return;
			}
			cb(null, chunk);
		},
	});
	// `pipe` conserva la backpressure: no se bufferiza más allá del highWaterMark.
	limiter.on("error", () => {
		payload.unpipe(limiter);
		payload.destroy(); // el emisor ya se pasó del techo: se corta el socket
	});
	// `pipe` NO propaga los errores del origen: si el cliente aborta o se cae el socket, el limiter
	// se quedaría abierto para siempre (handler colgado) y el 'error' del payload quedaría sin
	// listener. Lo trasladamos al destino, que es quien lee el consumidor. `destroy` sobre un
	// stream ya destruido es no-op, así que el handler de arriba puede volver a tocarlo sin riesgo.
	payload.on("error", (err: Error) => limiter.destroy(err));
	payload.pipe(limiter);
	done(null, limiter);
}
