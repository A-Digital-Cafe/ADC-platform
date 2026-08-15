import { Transform } from "node:stream";
import type { IncomingHttpHeaders } from "node:http";
import { platformSetting } from "@common/utils/platform-settings.ts";
import { acquireUploadSlot, perUploadBytesPerSec, type UploadSlot } from "@common/utils/bandwidth-governor.ts";

/**
 * Modelado del tráfico ENTRANTE: guardia de inactividad y reparto del caudal, en un solo lugar.
 *
 * Van juntos porque envuelven el mismo stream y **tienen que verse entre sí**: al frenar una subida,
 * la contrapresión llega al socket y dejan de entrar bytes, así que un guardia separado leería la
 * pausa que provoca el estrangulador como un cliente colgado y cortaría a quien se porta bien.
 *
 * Va en `preParsing`, que corre antes de que Fastify lea el cuerpo y para todo tipo de contenido; el
 * parser de binarios crudos sólo ve `application/octet-stream`, y un JSON de 900 KB entregado a un
 * byte por minuto —el ataque— no pasaría por ahí. Medido en este runtime, nada más lo corta:
 * `requestTimeout`/`connectionTimeout` quedan en 0 y no se aplican aunque se seteen, no hay tope de
 * conexiones, y el rate limit por endpoint vive *después* del parseo del cuerpo.
 *
 * No se modelan las requests sin cuerpo: un `GET` no puede colgar bytes de subida, y armarles un
 * temporizador mataría el SSE y los canales del túnel de dispositivos, callados a propósito durante
 * minutos. La lectura lenta de una respuesta es otro vector y no lo cubre esto.
 */

/** Sin cuerpo declarado no hay nada que modelar. */
export function hasRequestBody(headers: IncomingHttpHeaders): boolean {
	const declared = Number(headers["content-length"]);
	if (Number.isFinite(declared) && declared > 0) return true;
	return String(headers["transfer-encoding"] ?? "").toLowerCase().includes("chunked");
}

/**
 * A partir de acá la transferencia entra al reparto del caudal. Por debajo lleva guardia de
 * inactividad pero no se estrangula ni se cuenta: un formulario de 2 KB no es un problema de ancho
 * de banda, y contarlo le robaría una fracción del caño a las subidas de verdad.
 */
const SHAPE_MIN_BYTES = 256 * 1024;

function isBulkUpload(headers: IncomingHttpHeaders): boolean {
	const declared = Number(headers["content-length"]);
	if (Number.isFinite(declared)) return declared >= SHAPE_MIN_BYTES;
	// Sin longitud declarada (chunked) no se sabe cuánto viene: se asume que es una transferencia.
	return true;
}

/** Ráfaga tolerada: un segundo de caudal acumulado, para no cortar en pedacitos una subida sana. */
const BURST_SECONDS = 1;

export interface ShapingConfig {
	/** Milisegundos sin recibir un byte tras los cuales se corta el cuerpo. `0` desactiva el guardia. */
	idleBodyTimeoutMs: number;
}

const DEFAULT_IDLE_BODY_TIMEOUT_MS = 30_000;

export function readShapingConfig(): ShapingConfig {
	const raw = platformSetting("HTTP_IDLE_BODY_TIMEOUT_MS") ?? process.env.HTTP_IDLE_BODY_TIMEOUT_MS;
	const parsed = Number(raw);
	if (raw !== undefined && raw !== "" && Number.isFinite(parsed) && parsed >= 0) return { idleBodyTimeoutMs: Math.floor(parsed) };
	return { idleBodyTimeoutMs: DEFAULT_IDLE_BODY_TIMEOUT_MS };
}

/** 408 y no 400: el cuerpo no vino mal, vino tarde. Fastify usa `statusCode` del error del parseo. */
function bodyIdleError(idleMs: number): Error & { statusCode: number; code: string } {
	return Object.assign(new Error(`El cuerpo de la petición dejó de avanzar por más de ${Math.round(idleMs / 1000)}s.`), {
		statusCode: 408,
		code: "REQUEST_BODY_IDLE",
	});
}

/**
 * Envuelve el cuerpo entrante. Devuelve el stream que tiene que seguir el pipeline.
 *
 * @param onIdleCut Se invoca cuando se corta por inactividad, para dejarlo en el log: el síntoma del
 * lado del cliente es un 408 sin más contexto, y sin esta línea no hay forma de ver el patrón.
 */
export function createTrafficShaper(headers: IncomingHttpHeaders, config: ShapingConfig, onIdleCut: (detail: string) => void): Transform {
	const idleMs = config.idleBodyTimeoutMs;
	const bulk = isBulkUpload(headers);
	// El cupo se toma aunque no haya caudal configurado: así el panel puede mostrar cuántas
	// transferencias hay en curso, y subir el caudal en caliente alcanza a las que ya estaban.
	const slot: UploadSlot | null = bulk ? acquireUploadSlot() : null;

	let timer: ReturnType<typeof setTimeout> | null = null;
	let tokens = 0;
	let lastRefillAt = Date.now();
	let bytes = 0;

	const shaper = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			bytes += chunk.length;
			arm();
			const rate = bulk ? perUploadBytesPerSec() : Number.POSITIVE_INFINITY;
			if (!Number.isFinite(rate)) {
				callback(null, chunk);
				return;
			}

			const now = Date.now();
			tokens = Math.min(rate * BURST_SECONDS, tokens + (rate * (now - lastRefillAt)) / 1000);
			lastRefillAt = now;
			tokens -= chunk.length;
			if (tokens >= 0) {
				callback(null, chunk);
				return;
			}

			// Deuda: se espera lo que tarde en generarse, con el guardia APAGADO y no rearmado. El
			// silencio lo provocamos nosotros, y con una espera más larga que el propio tope —caudal
			// bajo con chunks grandes— se dispararía sobre un cliente sano. Medido: con 64 KiB/s y
			// tope de 3 s, una subida sana moría con 408 a los cuatro segundos.
			const waitMs = Math.ceil((-tokens / rate) * 1000);
			disarm();
			setTimeout(() => {
				arm();
				callback(null, chunk);
			}, waitMs).unref?.();
		},
		flush(callback) {
			finish();
			callback(null);
		},
	});

	function disarm(): void {
		if (timer) clearTimeout(timer);
		timer = null;
	}

	function arm(): void {
		if (idleMs <= 0) return;
		disarm();
		timer = setTimeout(() => {
			timer = null;
			onIdleCut(`sin datos por ${Math.round(idleMs / 1000)}s tras ${bytes} byte(s)`);
			shaper.destroy(bodyIdleError(idleMs));
		}, idleMs);
		timer.unref?.();
	}

	function finish(): void {
		disarm();
		slot?.release();
	}

	// `close` cubre los caminos que `flush` no ve (cliente que aborta, error del socket, destrucción
	// desde arriba): sin esto el cupo quedaría tomado para siempre y el reparto iría achicando la
	// fracción de un caño que en realidad está libre.
	shaper.on("close", finish);
	arm();
	return shaper;
}
