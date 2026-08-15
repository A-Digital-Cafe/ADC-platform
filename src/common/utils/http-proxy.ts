import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import { Readable, Transform } from "node:stream";
import { pipeStreamToRaw, type RawResponseSink } from "./http-stream.ts";

/**
 * Superficie mínima de la request que necesita el proxy. Estructural a propósito, igual que
 * `RawResponseSink`: `@common` no depende de fastify ni de `@interfaces`, y así el mismo motor
 * sirve para el gateway S3, el gateway entre nodos y cualquier wrapper que exponga el crudo.
 */
interface ProxyRequest {
	raw: {
		method?: string;
		url?: string;
		headers: IncomingHttpHeaders;
	};
	body?: unknown;
}

/** Respuesta hijackeable: el proxy escribe sobre el socket crudo, no sobre el framework. */
interface ProxyReply {
	hijack: () => unknown;
	raw: RawResponseSink & { headersSent: boolean; writableEnded: boolean };
}

/** A dónde va esta request. */
export interface ProxyTarget {
	host: string;
	port: number;
	/** Headers a sumar (o pisar) en la request saliente: `X-ADC-Forwarded-By`, `X-Forwarded-For`. */
	headers?: OutgoingHttpHeaders;
}

export interface StreamingProxyOptions {
	/**
	 * Destino de la request cuando el llamador no lo pasa explícito. Devolver `null` responde el
	 * código `noUpstream`: el handler SIEMPRE contesta, así que quien quiera declinar y dejar que
	 * siga el ruteo local tiene que decidirlo antes de invocarlo.
	 */
	pickUpstream?: (request: ProxyRequest) => ProxyTarget | null;
	/**
	 * Última chance de tocar los headers de la respuesta antes de escribirlos. Existe para lo que
	 * es específico de un gateway y sería un agujero en otro: el relleno de
	 * `access-control-allow-origin` del gateway S3 vale porque las URLs presignadas viajan sin
	 * cookies, y no vale para nada que se sirva con sesión.
	 */
	onUpstreamHeaders?: (headers: OutgoingHttpHeaders, request: ProxyRequest) => void;
	/** Prefijo de los logs (`[S3Gateway]`), para no perder de vista qué gateway se quejó. */
	label: string;
	logger: { logWarn(msg: string): void };
	/**
	 * Milisegundos **sin progreso** tras los cuales se corta el reenvío. `0` lo desactiva. Ver
	 * `PROGRESS_TIMEOUT_MS`: no es un tope de duración de la transferencia.
	 */
	progressTimeoutMs?: number;
	/** Códigos de error del cuerpo JSON, para conservar los que ya publica cada gateway. */
	errorCodes?: { noUpstream?: string; unavailable?: string; writeFailed?: string; stalled?: string };
}

/**
 * El tercer parámetro lleva default —y no `?`— para que la aridad compilada del handler quede en 2:
 * el `fastify-server` distingue handlers de Express por `handler.length >= 3` y los envolvería.
 */
export type StreamingProxyHandler = (request: ProxyRequest, reply: ProxyReply, target?: ProxyTarget | null) => void;

/**
 * Cabeceras hop-by-hop (RFC 9110 §7.6.1): son del salto, no del mensaje, y reenviarlas rompe
 * (`transfer-encoding` duplicado, `connection` del socket equivocado). `host` NO está acá a
 * propósito: la firma SigV4 lo cubre y tiene que llegar al upstream tal como lo mandó el navegador;
 * el gateway entre nodos depende de lo mismo para que el vecino rutee por vhost.
 */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

/**
 * Además, en el sentido de ida se cae `expect`. El `100-continue` se negocia con el salto inmediato:
 * a esta altura el propio servidor ya se lo contestó al cliente para poder leerle el cuerpo.
 * Reenviarlo deja al cliente HTTP saliente esperando un segundo `100` y **la subida se cuelga hasta
 * el timeout** (verificado con `curl --data-binary` de 2 MB, que lo manda solo).
 */
const DROPPED_UPSTREAM = new Set([...HOP_BY_HOP, "expect"]);

/**
 * Métodos a los que `fetch` se niega a ponerles cuerpo (`TypeError` antes de abrir el socket). Un
 * `GET` con cuerpo es legal pero no existe ni en S3 ni entre nodos, así que se drena y se reenvía
 * sin él: perder un cuerpo que nadie manda es mejor que un 502 en el caso normal.
 */
const BODYLESS_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Respuestas que no pueden llevar cuerpo. `content-length` se cae **sólo** en éstas: cuando el
 * upstream no manda ninguno, `fetch` sintetiza `content-length: 0`, y RFC 9112 §6.2 prohíbe ese
 * header en 1xx/204. En un 304 sí se conserva el que haya llegado (ahí describe el cuerpo que
 * tendría el 200, y `fetch` no lo pisa: verificado con un 304 que trae `content-length: 12345`).
 */
function isBodyless(status: number, method: string | undefined): boolean {
	return status === 204 || status === 304 || status < 200 || method?.toUpperCase() === "HEAD";
}

function sanitizeHeaders(headers: IncomingHttpHeaders | OutgoingHttpHeaders, dropped: Set<string> = HOP_BY_HOP): OutgoingHttpHeaders {
	const out: OutgoingHttpHeaders = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value === undefined || dropped.has(key.toLowerCase())) continue;
		out[key] = value as OutgoingHttpHeaders[string];
	}
	return out;
}

/**
 * Reconstruye el cuerpo que fastify ya parseó, en el formato que anuncia su `content-type`.
 *
 * Es una **reconstrucción, no los bytes originales**: un JSON vuelve con otro espaciado y otro orden
 * de claves, así que una firma HMAC calculada sobre el cuerpo crudo no sobrevive al reenvío. Lo que
 * el provider deja pasar como stream (binarios, tipos no registrados) no pasa por acá y viaja byte
 * a byte.
 */
function serializeParsedBody(body: unknown, contentType: string | undefined): Buffer | null {
	if (body === undefined || body === null || body === "") return null;
	if (Buffer.isBuffer(body)) return body;
	if (typeof body === "string") return Buffer.from(body);
	if (typeof body !== "object") return Buffer.from(String(body));
	if (contentType?.includes("x-www-form-urlencoded")) return Buffer.from(new URLSearchParams(body as Record<string, string>).toString());
	return Buffer.from(JSON.stringify(body));
}

/**
 * URL del salto siguiente. El path y la query van **crudos**, tal como llegaron por el socket: la
 * firma SigV4 los cubre byte a byte y cualquier normalización la invalida.
 *
 * Lo que igual normaliza el parser de URL de la plataforma web (medido en Bun 1.3.14): los
 * segmentos `.` y `..` se resuelven (`/a/../b` → `/b`) y un path que **empieza** con `//` pierde una
 * barra. Lo demás sobrevive verbatim —`%2F`, `%20`, `//` interno, parámetro vacío, `+`, `=`
 * escapado—. Un navegador aplica esas mismas dos reglas antes de mandar la request, así que el
 * cliente típico ya no las produce; para el que las produzca queda el aviso de `rewrittenTarget`.
 */
function upstreamUrl(target: ProxyTarget, rawUrl: string | undefined): string {
	// Un IPv6 llega sin corchetes (así lo publica el registro de nodos) y una URL los exige.
	const authority = target.host.includes(":") ? `[${target.host}]` : target.host;
	return `http://${authority}:${target.port}${rawUrl ?? "/"}`;
}

/**
 * Traduce los headers entrantes a `Headers`. Uno por uno y con `append` porque un mismo nombre puede
 * venir repetido (node lo entrega como arreglo) y un objeto plano se quedaría con el último.
 */
function toFetchHeaders(headers: OutgoingHttpHeaders): Headers {
	const out = new Headers();
	for (const [key, value] of Object.entries(headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) for (const item of value) out.append(key, String(item));
		else out.append(key, String(value));
	}
	return out;
}

/**
 * Headers de la respuesta, con los `Set-Cookie` enteros.
 *
 * Iterar `Headers` colapsa los repetidos y **se queda con el último** (medido: dos
 * `WWW-Authenticate` dejan uno solo), así que los `set-cookie` —que son varios por definición: la
 * sesión, el refresh, la de build— se recuperan aparte con `getSetCookie()`. Sin esto, un login
 * reenviado entre nodos perdería todas las cookies menos una.
 */
function headersFromResponse(response: Response): OutgoingHttpHeaders {
	const out: OutgoingHttpHeaders = {};
	for (const [key, value] of response.headers) {
		if (key === "set-cookie" || HOP_BY_HOP.has(key)) continue;
		out[key] = value;
	}
	const cookies = response.headers.getSetCookie?.() ?? [];
	if (cookies.length > 0) out["set-cookie"] = cookies;
	if (response.status === 204 || response.status < 200) delete out["content-length"];
	return out;
}

/**
 * Motor de proxy reverso **streaming** sobre el socket crudo, sin bufferizar ni reescribir nada.
 *
 * Reenvía verbatim: ni auth, ni CSRF, ni parseo, ni normalización de URL (va fuera de
 * `@RegisterEndpoint` por el mismo motivo que el túnel de Drive). Quien lo monta decide qué
 * requests le entrega; el motor no tiene opinión sobre eso.
 *
 * El transporte de ida es `fetch` y no el `ClientRequest` de `node:http`: en Bun ese
 * `ClientRequest` **nunca emite `drain`**, así que bombearle un cuerpo grande se clava pasado ~1 MiB
 * (medido: un PUT de 4 MiB se detiene en 1051030 bytes). Con el cuerpo como `ReadableStream`,
 * `fetch` sí respeta contrapresión. Lo que no sobrevive a este transporte —upgrades a WebSocket y
 * los valores de los trailers— tampoco funcionaba antes.
 */
/**
 * Cuánto se tolera **sin progreso** en el tramo de ida, y no un tope de duración: cada chunk que se
 * le entrega al upstream lo rearma, así que una subida de media hora que avanza no lo toca.
 *
 * No sirve un `AbortSignal.timeout` sobre el `fetch`, que abortaría la petición entera y cortaría
 * toda subida grande. Lo que hay que cortar es al upstream que dejó de contestar y al cliente que
 * dejó de mandar, y los dos se ven como ausencia de progreso: un reenvío colgado sostiene DOS
 * sockets, y en el gateway entre nodos, recursos en dos máquinas.
 */
const PROGRESS_TIMEOUT_MS = 60_000;

export function createStreamingProxyHandler(options: StreamingProxyOptions): StreamingProxyHandler {
	const { pickUpstream, onUpstreamHeaders, label, logger } = options;
	const progressTimeoutMs = options.progressTimeoutMs ?? PROGRESS_TIMEOUT_MS;
	const codes = {
		noUpstream: "NO_UPSTREAM",
		unavailable: "UPSTREAM_UNAVAILABLE",
		writeFailed: "UPSTREAM_WRITE_FAILED",
		stalled: "UPSTREAM_STALLED",
		...options.errorCodes,
	};

	return (request, reply, target = null) => {
		const raw = reply.raw;
		// Antes de tocar el socket: tras esto Fastify no administra la respuesta (ni sus headers).
		reply.hijack();

		let responded = false;
		const respondError = (status: number, error: string): void => {
			if (responded) return;
			responded = true;
			try {
				if (!raw.headersSent && !raw.writableEnded) {
					raw.writeHead(status, { "Content-Type": "application/json" });
					raw.end(JSON.stringify({ error }));
				} else if (!raw.writableEnded) {
					// La respuesta ya arrancó: cortar el socket es lo único honesto que queda.
					raw.destroy?.();
				}
			} catch {
				/* socket ya muerto */
			}
		};

		const upstreamTarget = target ?? pickUpstream?.(request) ?? null;
		if (!upstreamTarget) {
			respondError(502, codes.noUpstream);
			return;
		}

		const method = request.raw.method ?? "GET";
		const headers = toFetchHeaders({ ...sanitizeHeaders(request.raw.headers, DROPPED_UPSTREAM), ...upstreamTarget.headers });
		const body = request.body as Readable | undefined;
		const streaming = body !== undefined && typeof body?.pipe === "function";

		// El cliente cortó: cancelar la request saliente para no dejarle el socket colgado al
		// upstream. Después de que la respuesta arrancó lo maneja `pipeStreamToRaw`, que destruye el
		// stream de bajada (y con él, la conexión).
		const aborter = new AbortController();
		raw.on("close", () => {
			if (!responded) aborter.abort();
		});

		// Reloj de progreso: lo rearma cada chunk entregado al upstream y se apaga cuando llega la
		// respuesta. `timedOut` distingue este corte del cliente que se fue, que sale por el mismo
		// `catch` y no merece ni log de error ni respuesta.
		let timedOut = false;
		let progressTimer: ReturnType<typeof setTimeout> | null = null;
		const clearProgress = (): void => {
			if (progressTimer) clearTimeout(progressTimer);
			progressTimer = null;
		};
		const armProgress = (): void => {
			if (progressTimeoutMs <= 0 || responded) return;
			clearProgress();
			progressTimer = setTimeout(() => {
				timedOut = true;
				aborter.abort();
			}, progressTimeoutMs);
			progressTimer.unref?.();
		};

		// Distingue "no pude entregar el cuerpo" de "el upstream no contestó": son dos códigos de
		// error distintos en el README de cada gateway, y con `fetch` los dos llegan por el mismo
		// `catch`.
		let bodyFailed = false;
		let outgoing: BodyInit | undefined;
		if (streaming && BODYLESS_METHODS.has(method.toUpperCase())) {
			// Drenar: sin consumirlo, el socket entrante queda a medio leer y la conexión no se recicla.
			body.resume();
			headers.delete("content-length");
		} else if (streaming) {
			outgoing = Readable.toWeb(
				guardShortBody(
					body,
					headers.get("content-length"),
					() => {
						bodyFailed = true;
					},
					armProgress
				)
			) as unknown as ReadableStream;
		} else {
			// Los content-type que fastify SÍ parsea (json, formularios, texto) llegan como objeto o
			// string: el stream original ya se consumió, así que hay que reescribirlo o el upstream
			// espera para siempre un cuerpo que nadie manda. `content-length` se recalcula porque el del
			// cliente describe los bytes originales, no éstos.
			const rewritten = serializeParsedBody(request.body, request.raw.headers["content-type"]);
			if (rewritten) {
				headers.set("content-length", String(rewritten.byteLength));
				// El cast es de tipos, no de datos: un `Buffer` ES un `Uint8Array`, pero su
				// `ArrayBufferLike` no encaja en el `BodyInit` del DOM sin copiar los bytes.
				outgoing = rewritten as unknown as BodyInit;
			} else {
				headers.delete("content-length");
			}
		}

		const retargeted = rewrittenTarget(request.raw.url);
		if (retargeted) logger.logWarn(`${label} El destino no sale verbatim (${retargeted}): ${request.raw.url}`);

		armProgress();
		void fetch(upstreamUrl(upstreamTarget, request.raw.url), {
			method,
			headers,
			body: outgoing,
			// Mitad dúplex: se manda el cuerpo entero y recién después se lee la respuesta. Obligatorio
			// para un cuerpo en streaming.
			duplex: "half",
			// Un 3xx es del cliente, no nuestro: seguirlo acá lo dejaría sin ver el `Location` —y en S3
			// mandaría la firma a otro host—.
			redirect: "manual",
			// Sin esto `fetch` pide `accept-encoding: gzip, …` por su cuenta, descomprime la respuesta y
			// **conserva** `content-encoding: gzip` con el `content-length` viejo: el cliente recibiría
			// un cuerpo que no coincide con sus propios headers.
			decompress: false,
			signal: aborter.signal,
		} as RequestInit)
			.then((response) => {
				// El upstream contestó: de acá en más el ritmo lo pone el cliente bajando, y eso lo
				// gobierna `pipeStreamToRaw`.
				clearProgress();
				if (responded) return;
				responded = true;
				const bodyless = isBodyless(response.status, method);
				const outHeaders = headersFromResponse(response);
				onUpstreamHeaders?.(outHeaders, request);
				// 204/304/HEAD: `fetch` igual entrega un stream (vacío), pero escribirlo obligaría a
				// esperar un cuerpo que por definición no llega.
				if (bodyless || !response.body) {
					raw.writeHead(response.status, outHeaders);
					raw.end();
					void response.body?.cancel().catch(() => undefined);
					return;
				}
				pipeStreamToRaw(Readable.fromWeb(response.body as never), raw, response.status, outHeaders, (error) =>
					logger.logWarn(`${label} Corte bajando respuesta del upstream: ${(error as Error).message}`)
				);
			})
			.catch((error: Error) => {
				clearProgress();
				if (timedOut) {
					logger.logWarn(
						`${label} Reenvío a ${upstreamTarget.host}:${upstreamTarget.port} cortado por ${progressTimeoutMs} ms sin progreso: ${request.raw.url}`
					);
					respondError(504, codes.stalled);
					return;
				}
				// El cliente se fue: no hay a quién contestarle y no es una falla del upstream.
				if (aborter.signal.aborted) return;
				// "Cortado" y no "falló": por acá pasan tanto el upstream inalcanzable como el cliente
				// que cancela la subida a mitad, y el segundo no es una falla del vecino.
				logger.logWarn(`${label} Reenvío a ${upstreamTarget.host}:${upstreamTarget.port} cortado: ${error.message}`);
				respondError(502, bodyFailed ? codes.writeFailed : codes.unavailable);
			});
	};
}

/**
 * Corta la subida con error si el cuerpo termina **antes** de completar el `content-length` que se
 * le declaró al upstream. Sin esto `fetch` se queda esperando los bytes que faltan y nadie contesta
 * (medido: 10 bytes sobre 100 declarados = cuelgue indefinido). Pasa cuando el cliente aborta a
 * mitad de una subida, que es exactamente el caso que no puede quedar colgado.
 *
 * De paso es la etapa que aísla al stream del cliente del pipeline saliente, igual que el
 * `PassThrough` que había antes: un fallo del reenvío no destruye la request entrante antes de
 * poder responderle.
 */
function guardShortBody(body: Readable, contentLength: string | null, onFailure: () => void, onProgress: () => void): Readable {
	const declared = Number(contentLength);
	let seen = 0;
	const guard = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			seen += chunk.length;
			onProgress();
			callback(null, chunk);
		},
		flush(callback) {
			if (Number.isFinite(declared) && contentLength !== null && seen < declared) {
				onFailure();
				callback(new Error(`cuerpo cortado: ${seen} de ${declared} bytes declarados`));
				return;
			}
			callback(null);
		},
	});
	// `pipe` no propaga los errores del origen: sin esto, un cliente que se corta dejaría el guard
	// abierto para siempre y la request saliente esperando.
	body.on("error", (error) => {
		onFailure();
		guard.destroy(error);
	});
	body.pipe(guard);
	return guard;
}

/**
 * Avisa por los dos —y únicos— casos en que el request-target no sale byte a byte como entró. Es
 * diagnóstico, no defensa: con SigV4 el síntoma es un `403 SignatureDoesNotMatch` del object
 * storage, que sin esta línea no tiene forma de rastrearse hasta el proxy.
 *
 * Se mira sólo el path (la query viaja intacta, incluido un `/../` dentro de un parámetro) y con
 * comparaciones de string: reparsear la URL en cada request proxeada para un caso que casi nunca
 * ocurre sale más caro que el propio chequeo.
 */
function rewrittenTarget(rawUrl: string | undefined): string | null {
	if (!rawUrl) return null;
	const path = rawUrl.split("?")[0];
	if (path.startsWith("//")) return "el path empieza con // y pierde una barra";
	if (path.includes("/./") || path.includes("/../") || path.endsWith("/.") || path.endsWith("/..")) return "los segmentos . y .. se resuelven";
	return null;
}
