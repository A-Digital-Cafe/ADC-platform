import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import * as path from "node:path";
import type { IncomingMessage } from "node:http";
import { Transform } from "node:stream";
import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import { BaseProvider, ProviderType } from "../../BaseProvider.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import { Scope, assertScope, type Capability } from "@common/security/Capability.ts";
import type { IHostBasedHttpProvider, HostOptions, HttpHandler, RequestForwarder } from "../../../interfaces/modules/providers/IHttpServer.js";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import {
	acquireInflight,
	ALLOWED_CORS_HEADERS,
	ALLOWED_HTTP_METHODS,
	applySecurityHeaders,
	countryFromRequest,
	createCorsOriginGuard,
	createTrafficShaper,
	getAllowHeader,
	getBodyLimitBytes,
	getCspNonce,
	getMaxInflightBodiesPerIp,
	getRawBodyLimitBytes,
	hasRequestBody,
	isAllowedHttpMethod,
	injectCountry,
	isCspNonceEnabled,
	isSafeStaticPath,
	readShapingConfig,
	resolveTrustProxy,
	stampCspNonce,
	resolveSafeStaticPath,
	warnIfCorsAllowlistEmpty,
	warnIfNoTrustedProxies,
	type ShapingConfig,
} from "./security/index.js";
import { bandwidthBudget, configureBandwidth } from "@common/utils/bandwidth-governor.ts";
import { platformSetting } from "@common/utils/platform-settings.ts";
import { isRealProduction } from "@common/utils/runtime-env.ts";

type FastifyHandler = (req: FastifyRequest<any>, reply: FastifyReply<any>) => void | Promise<void>;

interface RegisteredHost {
	pattern: string;
	regex: RegExp;
	directory: string;
	options: HostOptions;
	priority: number;
	routes: Map<string, Map<string, FastifyHandler>>;
}

interface GlobalRoute {
	method: string;
	path: string;
	handler: FastifyHandler;
	/** Score de especificidad. Mayor = más específica. Se usa para ordenar la tabla de matching. */
	specificity: number;
	/**
	 * Módulo dueño de la ruta (`ownerName` del endpoint), si lo declaró. Permite podarla cuando el
	 * dueño se detiene: sin esto la tabla sólo crecía y el wrapper de una instancia ya destruida
	 * seguía atendiendo.
	 */
	owner?: string;
}

/**
 * Calcula la especificidad de un patrón de ruta. Más estática = mayor.
 * Garantiza que `/x/draft` se evalúe antes que `/x/:id` durante el matching.
 */
function routeSpecificity(pattern: string): number {
	const segments = pattern.split("/").filter(Boolean);
	let score = 0;
	for (const seg of segments) {
		if (seg.startsWith(":")) score += 1;
		else if (seg.includes("*")) score += 0;
		else score += 100;
	}
	// Desempate menor: rutas más largas son ligeramente preferidas.
	return score * 1000 + segments.length;
}

interface PathMatchResult {
	matched: boolean;
	params: Record<string, string>;
}

/**
 * Convierte un patrón de host a regex
 * "*.local.com" -> /^(.+)\.local\.com$/
 * "cloud.local.com" -> /^cloud\.local\.com$/
 */
function hostPatternToRegex(pattern: string): RegExp {
	const escaped = pattern.replaceAll(".", String.raw`\.`).replaceAll("*", "(.+)");
	return new RegExp(`^${escaped}$`, "i");
}

/**
 * Calcula la prioridad de un patrón de host
 * Patrones más específicos tienen mayor prioridad
 */
function calculatePriority(pattern: string, explicitPriority?: number): number {
	if (explicitPriority !== undefined) return explicitPriority;

	// Comodines tienen menor prioridad
	const wildcardCount = (pattern.match(/\*/g) || []).length;
	const parts = pattern.split(".");
	const specificity = parts.length * 10 - wildcardCount * 100;

	return specificity;
}

/**
 * Detecta si un handler es de Express (tiene 3 params: req, res, next)
 */
function isExpressHandler(handler: HttpHandler): boolean {
	return handler.length >= 3;
}

/**
 * Adapta un handler de Express a Fastify (solo cuando es necesario)
 */
function adaptExpressHandler(handler: any): FastifyHandler {
	return async (req: FastifyRequest, reply: FastifyReply) => {
		const expressRes = {
			status: (code: number) => {
				reply.code(code);
				return expressRes;
			},
			json: (data: any) => reply.send(data),
			send: (data: any) => reply.send(data),
			redirect: (url: string) => reply.redirect(url),
			setHeader: (key: string, value: string) => {
				reply.header(key, value);
				return expressRes;
			},
			header: (key: string, value: string) => {
				reply.header(key, value);
				return expressRes;
			},
			type: (contentType: string) => {
				reply.type(contentType);
				return expressRes;
			},
		};

		const next = (err?: any) => {
			if (err) reply.code(500).send({ error: err.message || "Internal error" });
		};

		await handler(req, expressRes, next);
	};
}

/**
 * Normaliza un handler a formato Fastify
 */
function normalizeHandler(handler: HttpHandler): FastifyHandler {
	if (isExpressHandler(handler)) {
		return adaptExpressHandler(handler);
	}
	return handler as FastifyHandler;
}

/** Error 413 para el techo de bodies binarios crudos (Fastify usa `statusCode` del error). */
function rawBodyTooLarge(message: string): Error & { statusCode: number } {
	return Object.assign(new Error(message), { statusCode: 413 });
}

/**
 * Implementación del servidor HTTP con Fastify y soporte para host-based routing
 */
export default class FastifyServerProvider extends BaseProvider implements IHostBasedHttpProvider {
	public readonly name = "fastify-server";
	public readonly type = ProviderType.HTTP_SERVER_PROVIDER;
	private readonly app: FastifyInstance<any>;
	private isListening = false;
	private readonly registeredHosts = new Map<string, RegisteredHost>();
	private readonly globalRoutes: GlobalRoute[] = [];
	private readonly globalStaticPaths = new Map<string, string>();
	/** Hosts en modo mantenimiento: patrón → mensaje. Sirven 503 en vez de la app. */
	private readonly maintenanceHosts = new Map<string, string>();
	/**
	 * Índice lateral de rutas de host por owner. Las rutas de host viven en `RegisteredHost.routes`
	 * (path → handler, sin dueño); este índice permite que `unregisterRoutesByOwner` también las
	 * pode sin cambiar la forma del map que recorre el matcher.
	 */
	private readonly hostRoutesByOwner: { owner: string; hostPattern: string; method: string; path: string }[] = [];
	/** Desviador del gateway entre nodos, si alguno se instaló. Ver `setRequestForwarder`. */
	#requestForwarder: { forward: RequestForwarder; owner?: string } | null = null;
	private defaultHost: RegisteredHost | null = null;
	private readonly isDev = process.env.NODE_ENV === "development";
	private apiDocsRegistered = false;

	constructor() {
		super();
		const http2Enabled = process.env.HTTP2_ENABLED === "true";

		// Configuración base de Fastify
		const fastifyOptions: any = {
			logger: false,
			bodyLimit: getBodyLimitBytes(),
			routerOptions: {
				ignoreTrailingSlash: true,
			},
		};

		// Proxies confiables (`TRUSTED_PROXIES`, documentado en `.env.example`). Sin lista la
		// opción no se setea y `request.ip` sigue siendo la IP del socket.
		const trustProxy = resolveTrustProxy();
		if (trustProxy) fastifyOptions.trustProxy = trustProxy;

		// TLS y HTTP/2 dentro del proceso: camino NO recomendado. Ver `#applyInProcessTls`.
		if (http2Enabled || process.env.SSL_CERT_PATH) this.#applyInProcessTls(fastifyOptions, http2Enabled);

		this.app = Fastify(fastifyOptions);
	}

	/**
	 * TLS y HTTP/2 **hablados por este proceso**. Sigue existiendo para un despliegue sin borde
	 * delante, pero no es la postura de la plataforma y el arranque lo dice.
	 *
	 * Qué se rompe al encenderlo —los clientes internos hablan `http://` fijo, y con h2 no pasan ni
	 * el handshake— está medido y tabulado en `docs/guides/tls-edge.md`.
	 */
	#applyInProcessTls(fastifyOptions: Record<string, unknown>, http2Enabled: boolean): void {
		const certPath = process.env.SSL_CERT_PATH;
		const keyPath = process.env.SSL_KEY_PATH;

		if (certPath && keyPath) {
			try {
				fastifyOptions.https = {
					cert: readFileSync(certPath),
					key: readFileSync(keyPath),
					// Correcto donde se respeta; en este runtime, medido, no cambia nada.
					...(http2Enabled ? { allowHTTP1: true } : {}),
				};
				if (http2Enabled) fastifyOptions.http2 = true;
				this.logger.logWarn(
					`TLS ${http2Enabled ? "+ HTTP/2 " : ""}servido por el propio proceso (SSL_CERT_PATH). ` +
						"La postura de la plataforma es terminar TLS en el borde y dejar este puerto plano en la red privada: " +
						"los clientes ENTRE NODOS hablan `http://` fijo y dejan de alcanzar a este nodo. Ver docs/guides/tls-edge.md."
				);
				if (http2Enabled) {
					this.logger.logWarn(
						"Bajo HTTP/2 no hay cabeceras de conexión: el SSE de notificaciones y las rutas crudas del túnel de dispositivos " +
							"dejan de funcionar. Y aunque va `allowHTTP1`, en este runtime NO se respeta (medido): un cliente que ofrece sólo " +
							"HTTP/1.1 no pasa siquiera el handshake TLS, así que NINGÚN cliente interno alcanza a este nodo."
					);
				}
			} catch (error: any) {
				this.logger.logWarn(`Error leyendo certificados SSL: ${error.message}. Se sirve en claro (TLS/HTTP2 deshabilitados).`);
			}
			return;
		}

		if (http2Enabled && this.isDev) {
			// HTTP/2 en claro: sólo sirve para probar el camino h2 en la máquina de quien desarrolla.
			fastifyOptions.http2 = true;
			fastifyOptions.http2SessionTimeout = 5000;
			this.logger.logWarn("HTTP/2 en claro (sin TLS) en desarrollo. No es un modo de producción.");
			return;
		}

		this.logger.logWarn(
			http2Enabled
				? "HTTP2_ENABLED=true sin SSL_CERT_PATH/SSL_KEY_PATH: se ignora y se sirve HTTP/1.1 en claro. Es lo esperado si el TLS lo termina el borde — en ese caso apagá la variable."
				: "SSL_CERT_PATH definido sin SSL_KEY_PATH: falta la llave, así que se sirve en claro."
		);
	}
	@OnlyKernel()
	public async start(_kernelKey: symbol): Promise<void> {
		await super.start(_kernelKey);
		this.#applyConfiguredBandwidth();
		await this.setupMiddleware();
	}

	/**
	 * Caudal de subida con el que arranca el nodo (el panel lo cambia en caliente por
	 * `configureBandwidth`). Se lee acá y no en el constructor porque la configuración de plataforma
	 * la instala un servicio que corre después de construirse este provider.
	 */
	#applyConfiguredBandwidth(): void {
		const raw = platformSetting("UPLOAD_BANDWIDTH_BYTES_PER_SEC") ?? process.env.UPLOAD_BANDWIDTH_BYTES_PER_SEC;
		const parsed = Number(raw);
		if (!raw || !Number.isFinite(parsed) || parsed <= 0) return;
		configureBandwidth(parsed);
		this.logger.logInfo(`Caudal de subida limitado a ${Math.round(bandwidthBudget() / 1024)} KiB/s repartidos entre las transferencias en curso.`);
	}

	private async setupMiddleware(): Promise<void> {
		// CORS - En desarrollo permitir credenciales desde cualquier localhost; en producción real,
		// sólo `CORS_ALLOWED_ORIGINS` (los vhosts registrados dejaron de ser allowlist).
		warnIfCorsAllowlistEmpty(this.logger);
		warnIfNoTrustedProxies(this.logger);
		await this.app.register(
			fastifyCors as any,
			{
				origin: createCorsOriginGuard(this.isDev, () => this.getRegisteredHosts()),
				credentials: true,
				methods: ALLOWED_HTTP_METHODS,
				allowedHeaders: ALLOWED_CORS_HEADERS,
			} as any
		);

		this.app.addHook("onRequest", async (request, reply) => {
			applySecurityHeaders(reply);
			if (!isAllowedHttpMethod(request.method)) {
				reply.header("Allow", getAllowHeader());
				reply.code(405).send({ error: "METHOD_NOT_ALLOWED", message: `Method ${request.method} is not allowed` });
			}
		});

		this.#installInflightCap();

		// Cookie parser - Necesario para setCookie/clearCookie en endpoints
		await this.app.register(fastifyCookie);

		// Body parser para formularios
		await this.app.register(fastifyFormbody);

		// Modelado del cuerpo entrante (inactividad + caudal), ANTES de los parsers: es lo que lo
		// distingue del techo de tamaño, que sólo mira los binarios crudos.
		this.#installTrafficShaper();

		// Binarios crudos: sin bufferizar (request.body sigue siendo un Readable). Fastify no
		// aplica `bodyLimit` a los parsers con firma de stream, así que el techo anti-abuso lo
		// pone este wrapper: atajo por Content-Length + contador real, porque un cliente puede
		// mandar chunked o declarar cualquier cosa. El tope por plan lo sigue poniendo cada
		// consumidor (ej. el túnel de Drive); esto sólo evita el caso "subida infinita".
		// Extraído a una constante para registrarlo dos veces; el cast en cada registro es porque
		// TS no elige el overload con callback de `addContentTypeParser` fuera del call site.
		//
		// El `pipe` es eager a propósito y así se queda. Se lo acusó de dejar las subidas grandes en
		// cero bytes cuando el handler hace `await` antes de leer el stream: es falso, y el banco que
		// lo "probó" usaba como cliente el `node:http` de Bun, que es justamente lo que está roto.
		// Medido con curl contra este mismo parser (Bun 1.3.14, 4 MB): 4194304 bytes en las cuatro
		// combinaciones —con y sin `await` de I/O, con Content-Length y chunked— y el techo cortando
		// con 413 por ambos caminos. Lo que se colgaba era el tramo SALIENTE de los proxies: el
		// `ClientRequest` de Bun nunca emite `drain` ni mueve `writableLength`/`socket.bytesWritten`,
		// así que un `pipeline` hacia el upstream se frenaba para siempre pasado ~1 MiB (por eso
		// `@common/utils/http-proxy.ts` sale por `fetch`). Volver esto perezoso (arrancar el pipe
		// recién en el primer `read`) no arreglaba aquello —se midió: seguía colgado— y sólo agrega
		// superficie donde hoy no falta nada. El cuerpo sí se pierde, en cambio, si el handler vuelve
		// sin `reply.hijack()` ni responder: ahí el server lo descarta y contesta 200 solo.
		const rawStreamParser = (request: FastifyRequest, payload: IncomingMessage, done: (err: Error | null, body?: unknown) => void) => {
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
			// `pipe` NO propaga los errores del origen: si el cliente aborta o se cae el socket,
			// el limiter se quedaría abierto para siempre (handler colgado) y el 'error' del
			// payload quedaría sin listener. Lo trasladamos al destino, que es quien lee el
			// consumidor. `destroy` sobre un stream ya destruido es no-op, así que el handler
			// de arriba puede volver a tocar el payload sin riesgo.
			payload.on("error", (err: Error) => limiter.destroy(err));
			payload.pipe(limiter);
			done(null, limiter);
		};
		this.app.addContentTypeParser("application/octet-stream", rawStreamParser as any);
		// Catch-all con la misma semántica: sin él, cualquier Content-Type no registrado muere en
		// un 415 ANTES de llegar a los handlers. Lo exige el gateway S3 (S3GatewayService): el PUT
		// presignado del navegador lleva el Content-Type real del archivo (`image/png`, `video/mp4`,
		// …) y tiene que atravesar el proxy como stream. Para los endpoints normales el cambio es
		// benigno: un tipo inesperado ahora llega como Readable y lo rechaza la validación (400).
		this.app.addContentTypeParser("*", rawStreamParser as any);

		// Log de peticiones en desarrollo
		if (this.isDev) {
			this.app.addHook("onRequest", async (request) => {
				this.logger.logDebug(`${request.method} ${request.hostname}${request.url}`);
			});
		}

		// Hook principal para host-based routing
		this.app.addHook("preHandler", (async (request: FastifyRequest<any>, _reply: FastifyReply<any>) => {
			const hostname = this.extractHostname(request);
			const matchedHost = this.matchHost(hostname);

			if (matchedHost) {
				// Almacenar el host matcheado en la request para uso posterior
				(request as any).matchedHost = matchedHost;
			}
		}) as any);

		// Usar setNotFoundHandler en lugar de catch-all para permitir que
		// Connect RPC y otras rutas registradas posteriormente funcionen
		this.app.setNotFoundHandler((async (request: FastifyRequest<any>, reply: FastifyReply<any>) => {
			await this.handleStaticRequest(request, reply);
		}) as any);
	}

	/**
	 * Tope de peticiones **con cuerpo** en vuelo por IP, tomado en `onRequest`: antes de leer un solo
	 * byte, que es el único momento en que el costo todavía no se pagó.
	 *
	 * El lugar se libera desde `close` de la respuesta cruda y no desde `onResponse`: las respuestas
	 * secuestradas (SSE, túnel de dispositivos, los dos gateways) nunca vuelven al framework, así que
	 * el contador de esas IPs no bajaría nunca.
	 */
	#installInflightCap(): void {
		const limit = getMaxInflightBodiesPerIp();
		if (limit <= 0) {
			this.logger.logWarn("Tope de peticiones con cuerpo en vuelo por IP DESACTIVADO (HTTP_MAX_INFLIGHT_BODIES_PER_IP=0).");
			return;
		}
		this.app.addHook("onRequest", async (request, reply) => {
			if (!hasRequestBody(request.headers)) return;
			const release = acquireInflight(request.ip, limit);
			if (!release) {
				this.logger.logWarn(`[http] ${request.ip} llegó al tope de ${limit} cuerpos en vuelo: ${request.method} ${request.url} rechazado.`);
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
	#installTrafficShaper(): void {
		const config: ShapingConfig = readShapingConfig();
		if (config.idleBodyTimeoutMs <= 0) {
			this.logger.logWarn("Guardia de inactividad del cuerpo DESACTIVADO (HTTP_IDLE_BODY_TIMEOUT_MS=0): una conexión lenta puede quedar abierta para siempre.");
		}
		this.app.addHook("preParsing", (request, _reply, payload, done) => {
			// Sin cuerpo no hay nada que modelar, y armarle un temporizador mataría el SSE.
			if (!hasRequestBody(request.headers)) {
				done(null, payload);
				return;
			}
			const shaper = createTrafficShaper(request.headers, config, (detail) =>
				this.logger.logWarn(`[http] cuerpo cortado por inactividad (${detail}): ${request.method} ${request.url} desde ${request.ip}`)
			);
			// `pipe` no propaga los errores del origen: un cliente que se corta dejaría el modelador
			// abierto y el parser esperando un cuerpo que ya no viene.
			payload.on("error", (error: Error) => shaper.destroy(error));
			payload.pipe(shaper);
			done(null, shaper);
		});
	}

	/**
	 * Host de la request para el ruteo por vhost.
	 *
	 * `headers.host` **antes** que `request.hostname`: con `trustProxy` activo fastify deriva
	 * `hostname` de `X-Forwarded-Host`, que el cliente puede mandar (el edge reenvía los headers
	 * desconocidos tal cual). `trustProxy` tiene que afectar a `request.ip`, no al ruteo.
	 */
	private extractHostname(request: FastifyRequest): string {
		const host = request.headers.host || request.hostname || "";
		// Eliminar puerto si existe
		return host.split(":")[0].toLowerCase();
	}

	private matchHost(hostname: string): RegisteredHost | null {
		// Ordenar hosts por prioridad (mayor primero)
		const sortedHosts = Array.from(this.registeredHosts.values()).sort((a, b) => b.priority - a.priority);

		for (const host of sortedHosts) {
			if (host.regex.test(hostname)) {
				return host;
			}
		}

		return this.defaultHost;
	}

	private async handleStaticRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
		// El gateway entre nodos se consulta ANTES de cualquier matching local, y no como último
		// recurso: la afinidad de conexión (el túnel de Drive habla con UN dispositivo) apunta a
		// rutas que TAMBIÉN existen acá, y servirlas localmente sería contestar desde el nodo que no
		// sostiene esa conexión. Sin gateway instalado no cuesta nada y el ruteo queda idéntico.
		if (this.#requestForwarder && (await this.#tryForward(request, reply))) return;

		const matchedHost = (request as any).matchedHost as RegisteredHost | undefined;
		let urlPath = request.url.split("?")[0];

		// Modo mantenimiento: si el host está deshabilitado, servir 503 por default.
		if (matchedHost && this.maintenanceHosts.has(matchedHost.pattern)) {
			this.serveMaintenance(reply, this.maintenanceHosts.get(matchedHost.pattern)!);
			return;
		}

		// Primero verificar rutas globales
		for (const route of this.globalRoutes) {
			if (route.method.toUpperCase() !== request.method) continue;

			const matchResult = this.matchPath(route.path, urlPath);
			if (matchResult.matched) {
				(request.params as any) = { ...(request.params as any), ...matchResult.params };
				return route.handler(request, reply);
			}
		}

		// Verificar rutas específicas del host
		const hostRoutes = matchedHost?.routes.get(request.method.toUpperCase());
		if (hostRoutes) {
			for (const [routePath, handler] of hostRoutes) {
				const matchResult = this.matchPath(routePath, urlPath);
				if (matchResult.matched) {
					(request.params as any) = { ...(request.params as any), ...matchResult.params };
					return handler(request, reply);
				}
			}
		}

		// Las rutas API no deben servirse como archivos estáticos. El guard va antes de CUALQUIER
		// fallback estático —también el de rutas globales sin host matcheado—: si no, entrando por
		// una IP o un host no registrado, un `serveStatic` de prefijo ancho se traga las rutas
		// `/api/*` y devuelve "File not found" en vez de este 404, sin dejar rastro en el log de dev.
		if (urlPath.startsWith("/api/")) {
			if (this.isDev) this.logger.logDebug(`API 404: ${request.method} ${urlPath} (${this.globalRoutes.length} rutas globales)`);
			reply.code(404).send({ error: "API route not found", path: urlPath });
			return;
		}

		// Si no hay host matcheado, intentar con rutas estáticas globales
		if (!matchedHost) {
			const global = this.#resolveGlobalStatic(urlPath);
			if (global) return this.serveFile(global.filePath, global.directory, reply);

			reply.code(404).send({ error: "Not Found", host: request.hostname });
			return;
		}

		// Servir archivos estáticos del host
		if (urlPath === "/" || urlPath === "") {
			urlPath = "/index.html";
		}

		const filePath = resolveSafeStaticPath(matchedHost.directory, urlPath);
		if (!filePath) {
			reply.code(404).send({ error: "File not found" });
			return;
		}

		// El directorio del host manda, pero no es lo único que se sirve: los assets de las UI
		// libraries (`/ui`), los de otros módulos UI (`/pub`) y el `common/public` montado en `/`
		// son rutas GLOBALES, y con un host matcheado no se consultaban nunca. Como todo host UI
		// lleva `spaFallback`, una imagen que no estaba en el build de la app devolvía el
		// `index.html` con 200 y `text/html`: el `<img>` quedaba roto y la URL directa no daba
		// ni un 404 que delatara el problema.
		if (!fs.existsSync(filePath)) {
			const global = this.#resolveGlobalStatic(urlPath);
			if (global) return this.serveFile(global.filePath, global.directory, reply);
		}

		await this.serveFile(filePath, matchedHost.directory, reply, matchedHost.options);
	}

	/**
	 * Ruta estática global que sirve `urlPath`, o `null` si ninguna tiene ese archivo.
	 *
	 * **Gana el prefijo más largo**, no el primero registrado: `common/public` se monta en `/`
	 * durante el registro del primer módulo UI, y `/` es prefijo de todo, así que por orden de
	 * inserción se tragaba `/ui`, `/pub` y los `/<namespace>/<módulo>` — quedaban registrados y
	 * eran inalcanzables.
	 *
	 * Exige que el archivo exista para devolverlo: así un `/ui/x` que no está en la UI library
	 * puede seguir cayendo al `common/public` de abajo, en vez de cortar con 404 en el primer
	 * prefijo que matchee.
	 */
	#resolveGlobalStatic(urlPath: string): { filePath: string; directory: string } | null {
		const byLongestPrefix = [...this.globalStaticPaths.entries()].sort((a, b) => b[0].length - a[0].length);

		for (const [pathPrefix, directory] of byLongestPrefix) {
			// Frontera de segmento: `/ui` no puede matchear `/uicorp/logo.png`.
			const prefix = pathPrefix.endsWith("/") ? pathPrefix.slice(0, -1) : pathPrefix;
			if (prefix && urlPath !== prefix && !urlPath.startsWith(`${prefix}/`)) continue;

			const rest = urlPath.slice(prefix.length);
			const relativePath = rest === "" || rest === "/" ? "/index.html" : rest;
			const filePath = resolveSafeStaticPath(directory, relativePath);
			if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return { filePath, directory };
		}

		return null;
	}

	private matchPath(pattern: string, urlPath: string): PathMatchResult {
		// Extraer nombres de parámetros del patrón
		const paramNames: string[] = [];
		const regexPattern = pattern
			.replaceAll(/:([^/]+)/g, (_match, paramName) => {
				paramNames.push(paramName);
				return "([^/]+)";
			})
			.replaceAll("*", ".*");

		const regex = new RegExp(`^${regexPattern}$`);
		const match = regex.exec(urlPath);

		if (!match) {
			return { matched: false, params: {} };
		}

		// Extraer valores de parámetros
		const params: Record<string, string> = {};
		paramNames.forEach((name, index) => {
			params[name] = match[index + 1];
		});

		return { matched: true, params };
	}

	private async serveFile(filePath: string, baseDir: string, reply: FastifyReply, options?: HostOptions): Promise<void> {
		try {
			if (!isSafeStaticPath(baseDir, filePath)) {
				reply.code(404).send({ error: "File not found" });
				return;
			}

			// Verificar que el archivo existe
			if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
				const ext = path.extname(filePath).toLowerCase();
				const contentType = this.getContentType(ext);

				applySecurityHeaders(reply, options?.headers);
				reply.header("Content-Type", contentType);
				const content = fs.readFileSync(filePath);
				reply.send(content);
				return;
			}

			// SPA fallback: si el archivo no existe y está habilitado, servir index.html
			if (options?.spaFallback) {
				const indexPath = resolveSafeStaticPath(baseDir, "/index.html");
				if (indexPath && fs.existsSync(indexPath)) {
					applySecurityHeaders(reply, options?.headers);
					reply.header("Content-Type", "text/html");
					const content = fs.readFileSync(indexPath);
					reply.send(content);
					return;
				}
			}

			reply.code(404).send({ error: "File not found" });
		} catch (error: any) {
			this.logger.logError(`Error serving file ${filePath}: ${error.message}`);
			reply.code(500).send({ error: "Internal server error" });
		}
	}

	private getContentType(ext: string): string {
		const types: Record<string, string> = {
			".html": "text/html; charset=utf-8",
			".js": "application/javascript; charset=utf-8",
			".mjs": "application/javascript; charset=utf-8",
			".css": "text/css; charset=utf-8",
			".json": "application/json; charset=utf-8",
			".txt": "text/plain; charset=utf-8",
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".svg": "image/svg+xml",
			".ico": "image/x-icon",
			".woff": "font/woff",
			".woff2": "font/woff2",
			".ttf": "font/ttf",
			".eot": "application/vnd.ms-fontobject",
			".map": "application/json",
			".webmanifest": "application/manifest+json",
			".webp": "image/webp",
			".avif": "image/avif",
		};
		return types[ext] || "application/octet-stream";
	}

	/** Obtener la instancia raw de Fastify. Requiere capability con scope `http:raw`. */
	getApp(token: Capability): FastifyInstance<any> {
		assertScope(token, Scope.HttpRaw);
		return this.app;
	}

	/**
	 * Registra rutas Connect RPC
	 * @param routes Función que define las rutas Connect RPC
	 * @param options Opciones para Connect RPC
	 */
	async registerConnectRPC(routes: (router: ConnectRouter) => void, options?: { prefix?: string }): Promise<void> {
		try {
			await this.app.register(fastifyConnectPlugin, {
				routes,
				...options,
			});
			const withPrefix = options?.prefix ? `con prefijo ${options.prefix}` : "";
			this.logger.logDebug(`Connect RPC registrado${withPrefix}`);
		} catch (error: any) {
			this.logger.logError(`Error registrando Connect RPC: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Registra un servicio Connect RPC individual
	 * @param service Implementación del servicio
	 * @param options Opciones de configuración
	 */
	async registerConnectService(service: Partial<ServiceImpl<any>>, options?: { prefix?: string }): Promise<void> {
		await this.registerConnectRPC((router) => {
			router.service(service as any, service);
		}, options);
	}

	registerRoute(method: string, path: string, handler: HttpHandler, owner?: string): void {
		const normalizedHandler = normalizeHandler(handler);
		const upperMethod = method.toUpperCase();

		// Reemplazo en el lugar si ya existe `method+path`: con un push incondicional, tras un
		// hot-reload el matcher (primera coincidencia) seguiría usando el wrapper de la instancia
		// vieja y la tabla crecería sin techo.
		const existing = this.globalRoutes.findIndex((r) => r.method === upperMethod && r.path === path);
		const route: GlobalRoute = {
			method: upperMethod,
			path,
			handler: normalizedHandler,
			specificity: routeSpecificity(path),
			owner,
		};
		if (existing >= 0) {
			const previous = this.globalRoutes[existing];
			this.globalRoutes[existing] = route;
			this.logger.logDebug(
				`Ruta global reemplazada: ${upperMethod} ${path}` + (previous.owner ? ` (owner previo: ${previous.owner})` : "")
			);
		} else {
			this.globalRoutes.push(route);
			this.logger.logDebug(`Ruta global registrada: ${upperMethod} ${path}${owner ? ` [${owner}]` : ""}`);
		}
		// Mantener invariante: tabla ordenada por especificidad descendente para
		// que el matcher (orden de iteración) priorice rutas estáticas.
		this.globalRoutes.sort((a, b) => b.specificity - a.specificity);
	}

	/**
	 * Retira las rutas globales de un owner. La invoca `EndpointManagerService` al desregistrar los
	 * endpoints de un módulo, para que no queden apuntando a la instancia muerta.
	 *
	 * Match por igualdad estricta: los endpoints de managers (`Owner::Manager`) quedan fuera a
	 * propósito, porque el orquestador los cubre con el gate de 503 de `setOwnerUnavailable`
	 * —mantenimiento reintentable en vez de 404—. Acá sólo caen las rutas crudas (SSE, túnel),
	 * que no pasan por ese gate.
	 *
	 * @returns Cuántas rutas se retiraron.
	 */
	unregisterRoutesByOwner(owner: string): number {
		const before = this.globalRoutes.length;
		for (let i = this.globalRoutes.length - 1; i >= 0; i--) {
			if (this.globalRoutes[i].owner === owner) this.globalRoutes.splice(i, 1);
		}
		let removed = before - this.globalRoutes.length;
		// También las rutas de host registradas a nombre del owner (ej. el catch-all del gateway S3).
		for (let i = this.hostRoutesByOwner.length - 1; i >= 0; i--) {
			const entry = this.hostRoutesByOwner[i];
			if (entry.owner !== owner) continue;
			this.hostRoutesByOwner.splice(i, 1);
			if (this.registeredHosts.get(entry.hostPattern)?.routes.get(entry.method)?.delete(entry.path)) removed++;
		}
		// El desviador es una ruta más en lo que importa acá: sobrevivirle a su dueño dejaría un
		// closure de una instancia muerta decidiendo a qué nodo va cada request.
		if (this.#requestForwarder?.owner === owner) this.setRequestForwarder(null);
		if (removed > 0) this.logger.logDebug(`Rutas retiradas de '${owner}': ${removed}`);
		return removed;
	}

	/**
	 * Registra Swagger UI en `/api/docs`. El documento OpenAPI se resuelve por
	 * request vía `transformSpecification`, de modo que refleja los endpoints
	 * registrados dinámicamente después del arranque.
	 */
	async registerApiDocs(getDocument: () => Record<string, unknown>): Promise<void> {
		if (this.apiDocsRegistered) return;
		this.apiDocsRegistered = true;

		const { default: fastifySwagger } = await import("@fastify/swagger");
		const { default: fastifySwaggerUi } = await import("@fastify/swagger-ui");

		await this.app.register(fastifySwagger, {
			openapi: { info: { title: "ADC Platform API", version: "1.0.0" } },
		});
		await this.app.register(fastifySwaggerUi, {
			routePrefix: "/api/docs",
			transformSpecification: () => getDocument() as any,
		});

		this.logger.logOk("Swagger UI disponible en /api/docs");
	}

	serveStatic(urlPath: string, directory: string): void {
		this.globalStaticPaths.set(urlPath, directory);
		this.logger.logDebug(`Archivos estáticos globales: ${urlPath} -> ${directory}`);
	}

	/**
	 * Pone (o saca) un host en modo mantenimiento: mientras esté activo, cualquier
	 * request a ese host responde 503 con una página de mantenimiento. Lo usa
	 * UIFederationService cuando el modules-manager deshabilita una app (prod).
	 */
	@OnlyKernel()
	setHostMaintenance(_kernelKey: symbol, hostPattern: string, on: boolean, message?: string): void {
		if (on) this.maintenanceHosts.set(hostPattern, message || "Esta aplicación no está disponible temporalmente.");
		else this.maintenanceHosts.delete(hostPattern);
		this.logger.logDebug(`Host ${hostPattern} ${on ? "en mantenimiento (503)" : "operativo"}`);
	}

	private serveMaintenance(reply: FastifyReply, message: string): void {
		applySecurityHeaders(reply);
		reply.header("Content-Type", "text/html; charset=utf-8");
		reply.header("Retry-After", "120");
		const safe = message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
		reply.code(503).send(
			`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
				`<title>No disponible temporalmente</title><style>html,body{height:100%;margin:0}` +
				`body{display:flex;align-items:center;justify-content:center;background:#0f1115;color:#e6e6e6;` +
				`font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.box{max-width:32rem;padding:2rem;text-align:center}` +
				`h1{font-size:1.4rem;margin:0 0 .75rem}p{color:#a0aec0;line-height:1.5}</style></head>` +
				`<body><div class="box"><h1>No disponible temporalmente</h1><p>${safe}</p></div></body></html>`
		);
	}

	registerHost(hostPattern: string, directory: string, options: HostOptions = {}): void {
		const priority = calculatePriority(hostPattern, options.priority);
		const regex = hostPatternToRegex(hostPattern);

		// Las rutas del host SOBREVIVEN a un re-registro. Registrar el mismo patrón otra vez es
		// normal —el drenaje de builds diferidos, un `rebuildModule`, un deploy git, un `enable()`—
		// y armar el objeto de cero descartaba en silencio todo lo que se hubiera registrado contra
		// ese patrón: `/sitemap.xml`, `/llms.txt`, `/_og/:file`. Peor todavía cuando el orden es el
		// inverso, que es el habitual con builds diferidos: `registerHostRoute` crea el host vacío
		// (abajo), la app registra su ruta, y el `registerHost` posterior la borraba. El síntoma es
		// que la ruta responde el `index.html` del host, sin ningún error en el log.
		const previousRoutes = this.registeredHosts.get(hostPattern)?.routes;

		const host: RegisteredHost = {
			pattern: hostPattern,
			regex,
			directory,
			options: {
				spaFallback: true,
				...options,
			},
			priority,
			routes: previousRoutes ?? new Map(),
		};

		this.registeredHosts.set(hostPattern, host);

		// Si es un comodín genérico, usarlo como default
		if (hostPattern === "*" || hostPattern === "*.*") {
			this.defaultHost = host;
		}

		this.logger.logDebug(`Host registrado: ${hostPattern} -> ${directory} (priority: ${priority})`);
	}

	registerHostRoute(hostPattern: string, method: string, path: string, handler: HttpHandler, owner?: string): void {
		let host = this.registeredHosts.get(hostPattern);

		if (!host) {
			// Crear host sin directorio si no existe
			this.registerHost(hostPattern, "", { spaFallback: false });
			host = this.registeredHosts.get(hostPattern)!;
		}

		const methodUpper = method.toUpperCase();
		if (!host.routes.has(methodUpper)) {
			host.routes.set(methodUpper, new Map());
		}

		const methodMap = host.routes.get(methodUpper)!;
		methodMap.set(path, normalizeHandler(handler));
		if (owner && !this.hostRoutesByOwner.some((r) => r.owner === owner && r.hostPattern === hostPattern && r.method === methodUpper && r.path === path)) {
			this.hostRoutesByOwner.push({ owner, hostPattern, method: methodUpper, path });
		}
		// Reordenar el Map por especificidad descendente para que rutas
		// estáticas (e.g. `/x/draft`) ganen frente a paramétricas (`/x/:id`).
		const sorted = Array.from(methodMap.entries()).sort(([a], [b]) => routeSpecificity(b) - routeSpecificity(a));
		host.routes.set(methodUpper, new Map(sorted));
		this.logger.logDebug(`Ruta de host registrada: ${hostPattern} ${methodUpper} ${path}`);
	}

	getRegisteredHosts(): string[] {
		return Array.from(this.registeredHosts.keys());
	}

	/**
	 * Reutiliza el mismo matcher que el ruteo, así que un host por defecto (`*`) hace que este nodo
	 * "sirva" cualquier hostname: es la verdad, porque ese comodín igual atendería la request.
	 */
	servesHost(hostname: string): boolean {
		return this.matchHost(hostname.split(":")[0].toLowerCase()) !== null;
	}

	hasGlobalRoute(method: string, path: string): boolean {
		const upper = method.toUpperCase();
		return this.globalRoutes.some((route) => route.method === upper && this.matchPath(route.path, path).matched);
	}

	setRequestForwarder(forwarder: RequestForwarder | null, owner?: string): void {
		this.#requestForwarder = forwarder ? { forward: forwarder, owner } : null;
		this.logger.logDebug(`Desviador entre nodos ${forwarder ? `instalado${owner ? ` [${owner}]` : ""}` : "retirado"}`);
	}

	/**
	 * Un desviador que explota no puede llevarse puesta la request: se sirve localmente, que es el
	 * comportamiento sin gateway. Salvo que ya haya escrito —ahí la respuesta es suya y no hay
	 * ruteo local posible, así que se la deja terminar (o morir) sola.
	 */
	async #tryForward(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
		try {
			return await this.#requestForwarder!.forward(request as FastifyRequest<any>, reply as FastifyReply<any>);
		} catch (error: any) {
			this.logger.logWarn(`Desvío entre nodos fallido (${error?.message}): se sirve localmente`);
			return reply.raw.headersSent || reply.raw.writableEnded;
		}
	}

	supportsHostRouting(): boolean {
		return true;
	}

	/**
	 * Sella con el nonce CSP los `<script>` inline del HTML servido. Va acá y no en
	 * `setupMiddleware` a propósito: los hooks `onSend` corren en orden de registro y fastify
	 * no admite ninguno después de `listen()`, así que registrarlo justo antes de escuchar lo
	 * deja ÚLTIMO — ve el HTML final, con el import map del archivo en disco más lo que
	 * inyectaron SEOService y el modules-manager. Registrado antes, esas inyecciones
	 * posteriores quedarían sin sellar y el navegador las bloquearía.
	 */
	/**
	 * Publica el país del visitante como `window.__ADC_COUNTRY__`. Se registra antes que el
	 * sellador de nonce para que el `<script>` que inserta quede sellado y el navegador lo ejecute.
	 *
	 * El `Vary` no es opcional: sin él, una caché intermedia serviría el HTML de un visitante
	 * argentino a uno de afuera, y al revés.
	 */
	#installCountryInjector(): void {
		this.app.addHook("onSend", (request, reply, payload, done) => {
			try {
				const contentType = String(reply.getHeader("content-type") ?? "");
				if (!contentType.includes("text/html")) return done(null, payload);

				// El `Vary` va SIEMPRE, aunque no haya país: si sólo se marcara la respuesta que
				// lleva el script, una caché podría guardar la versión sin país y devolvérsela a
				// alguien cuyo país sí conocemos.
				reply.header("Vary", [reply.getHeader("Vary"), "CF-IPCountry"].filter(Boolean).join(", "));

				const country = countryFromRequest(request as unknown as Parameters<typeof countryFromRequest>[0]);
				if (!country) return done(null, payload);

				let html: string;
				if (typeof payload === "string") html = payload;
				else if (Buffer.isBuffer(payload)) html = payload.toString("utf8");
				else return done(null, payload);
				return done(null, injectCountry(html, country));
			} catch {
				return done(null, payload);
			}
		});
	}

	#installCspNonceSealer(): void {
		if (!isCspNonceEnabled()) return;
		this.app.addHook("onSend", (request, reply, payload, done) => {
			try {
				const nonce = getCspNonce(request);
				if (!nonce) return done(null, payload);
				const contentType = String(reply.getHeader("content-type") ?? "");
				if (!contentType.includes("text/html")) return done(null, payload);
				// String o Buffer: los archivos estáticos se sirven con `readFileSync` (Buffer)
				// salvo que un inyector previo (SEO, modules-manager) ya lo haya pasado a string.
				// Los streams se dejan pasar: no hay ninguna respuesta HTML que los use.
				let html: string;
				if (typeof payload === "string") html = payload;
				else if (Buffer.isBuffer(payload)) html = payload.toString("utf8");
				else return done(null, payload);
				return done(null, stampCspNonce(html, nonce));
			} catch {
				// Nunca romper una respuesta por el sellado: sin nonce el navegador bloquea los
				// inline, pero un 500 acá tiraría la página entera.
				return done(null, payload);
			}
		});
	}

	/**
	 * A qué interfaz se ata el puerto del kernel. `0.0.0.0` por compatibilidad —en desarrollo hay que
	 * llegar desde el móvil de la LAN—, pero con un borde delante va la dirección de la overlay o
	 * loopback: ver `ADC_BIND_HOST` en `docs/guides/tls-edge.md`.
	 */
	#bindHost(): string {
		return process.env.ADC_BIND_HOST?.trim() || "0.0.0.0";
	}

	/**
	 * Avisa cuando el puerto queda abierto al mundo en producción real. Informa en vez de negarse
	 * porque no puede ver el firewall, y con firewall puesto la configuración es legítima.
	 */
	#warnIfPubliclyBound(host: string): void {
		if (!isRealProduction() || (host !== "0.0.0.0" && host !== "::")) return;
		const behindEdge = resolveTrustProxy() !== null;
		this.logger.logWarn(
			`El puerto del kernel escucha en TODAS las interfaces (ADC_BIND_HOST=${host}). ` +
				(behindEdge
					? "Con un borde delante, alcanzarlo directo saltea TLS, WAF y el rate limit del edge: cerralo por firewall o atalo a la dirección de la red privada."
					: "Además no hay TRUSTED_PROXIES declarados, así que si hay un borde delante toda la gente comparte su IP y el rate limit banea a todos juntos.") +
				" Ver docs/guides/tls-edge.md."
		);
	}

	async listen(port: number): Promise<void> {
		if (this.isListening) {
			this.logger.logWarn("El servidor ya está escuchando");
			return;
		}

		try {
			this.#installCountryInjector();
			this.#installCspNonceSealer();
			const host = this.#bindHost();
			this.#warnIfPubliclyBound(host);
			// Esperar a que el middleware esté listo antes de iniciar
			await this.app.listen({ port, host });
			this.isListening = true;
			this.logger.logOk(`Servidor Fastify escuchando en ${host}:${port}`);

			if (this.registeredHosts.size > 0) {
				this.logger.logInfo(`Hosts virtuales registrados: ${this.registeredHosts.size}`);
				for (const [pattern] of this.registeredHosts) {
					this.logger.logDebug(`  - ${pattern}`);
				}
			}
		} catch (error: any) {
			if (error.code === "EADDRINUSE") {
				this.logger.logError(`Puerto ${port} ya está en uso`);
			} else {
				this.logger.logError(`Error en el servidor: ${error.message}`);
			}
			throw error;
		}
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		if (this.isListening) {
			try {
				await this.app.close();
				this.isListening = false;
				this.logger.logOk("Servidor Fastify detenido");
			} catch (error: any) {
				this.logger.logError(`Error cerrando servidor: ${error.message}`);
				throw error;
			}
		}
	}
}
