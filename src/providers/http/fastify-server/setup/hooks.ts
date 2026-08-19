import type { FastifyInstance } from "fastify";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import {
	acquireInflight,
	applySecurityHeaders,
	createTrafficShaper,
	getAllowHeader,
	getMaxInflightBodiesPerIp,
	hasRequestBody,
	isAllowedHttpMethod,
	readShapingConfig,
	type ShapingConfig,
} from "../security/index.js";

/** Cabeceras de seguridad en toda respuesta + rechazo de métodos fuera de la lista. */
export function installMethodGuard(app: FastifyInstance<any>): void {
	app.addHook("onRequest", async (request, reply) => {
		applySecurityHeaders(reply);
		if (!isAllowedHttpMethod(request.method)) {
			reply.header("Allow", getAllowHeader());
			reply.code(405).send({ error: "METHOD_NOT_ALLOWED", message: `Method ${request.method} is not allowed` });
		}
	});
}

/**
 * Tope de peticiones **con cuerpo** en vuelo por IP, tomado en `onRequest`: antes de leer un solo
 * byte, que es el único momento en que el costo todavía no se pagó.
 *
 * El lugar se libera desde `close` de la respuesta cruda y no desde `onResponse`: las respuestas
 * secuestradas (SSE, túnel de dispositivos, los dos gateways) nunca vuelven al framework, así que
 * el contador de esas IPs no bajaría nunca.
 */
export function installInflightCap(app: FastifyInstance<any>, logger: ILogger): void {
	const limit = getMaxInflightBodiesPerIp();
	if (limit <= 0) {
		logger.logWarn("Tope de peticiones con cuerpo en vuelo por IP DESACTIVADO (HTTP_MAX_INFLIGHT_BODIES_PER_IP=0).");
		return;
	}
	app.addHook("onRequest", async (request, reply) => {
		if (!hasRequestBody(request.headers)) return;
		const release = acquireInflight(request.ip, limit);
		if (!release) {
			logger.logWarn(`[http] ${request.ip} llegó al tope de ${limit} cuerpos en vuelo: ${request.method} ${request.url} rechazado.`);
			reply.header("Retry-After", "5");
			await reply.code(429).send({
				error: "TOO_MANY_INFLIGHT_REQUESTS",
				message: `Demasiadas peticiones con cuerpo en curso desde esta dirección (máximo ${limit}). Esperá a que terminen las anteriores.`,
			});
			return reply;
		}
		reply.raw.on("close", release);
	});
}

/**
 * Guardia de inactividad + reparto del caudal sobre el cuerpo entrante (`traffic-shaper.ts`). Van
 * juntos porque el estrangulador provoca pausas que el guardia leería como un cliente colgado.
 */
export function installTrafficShaper(app: FastifyInstance<any>, logger: ILogger): void {
	const config: ShapingConfig = readShapingConfig();
	if (config.idleBodyTimeoutMs <= 0) {
		logger.logWarn("Guardia de inactividad del cuerpo DESACTIVADO (HTTP_IDLE_BODY_TIMEOUT_MS=0): una conexión lenta puede quedar abierta para siempre.");
	}
	app.addHook("preParsing", (request, _reply, payload, done) => {
		// Sin cuerpo no hay nada que modelar, y armarle un temporizador mataría el SSE.
		if (!hasRequestBody(request.headers)) {
			done(null, payload);
			return;
		}
		const shaper = createTrafficShaper(request.headers, config, (detail) =>
			logger.logWarn(`[http] cuerpo cortado por inactividad (${detail}): ${request.method} ${request.url} desde ${request.ip}`)
		);
		// `pipe` no propaga los errores del origen: un cliente que se corta dejaría el modelador
		// abierto y el parser esperando un cuerpo que ya no viene.
		payload.on("error", (error: Error) => shaper.destroy(error));
		payload.pipe(shaper);
		done(null, shaper);
	});
}
