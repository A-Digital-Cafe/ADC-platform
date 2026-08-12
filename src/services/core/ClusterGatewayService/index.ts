import { BaseService } from "../../BaseService.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import type { FastifyReply, FastifyRequest, IHostBasedHttpProvider } from "@interfaces/modules/providers/IHttpServer.js";
import type { IClusterService } from "@common/types/cluster/ICluster.ts";
import { clusterGatewayEnabled, nodeId } from "@common/utils/cluster-env.ts";
import { buildId } from "@common/utils/build-id.ts";
import { createStreamingProxyHandler, type ProxyTarget, type StreamingProxyHandler } from "@common/utils/http-proxy.ts";
import { NodePicker } from "./node-picker.js";
import { buildCookieHeader, isDocumentRequest, readBuildCookie } from "./build-affinity.js";

/** Marca del nodo que reenvió. Es el corta-bucles: una request que vuelve marcada no se reenvía. */
const FORWARDED_BY = "x-adc-forwarded-by";

/**
 * Lo que jamás se reenvía. `/healthz` es la sonda del balanceador y responde por ESTE proceso:
 * contestarla con la salud del vecino haría que el LB siga mandándole tráfico a un nodo roto.
 */
const NEVER_FORWARD = new Set(["/healthz"]);

/**
 * Extrae de una request la clave de afinidad del recurso que necesita (`tunnel:device:<id>`), o
 * `null` si esa request no depende de ninguna conexión viva.
 */
export type AffinityResolver = (request: FastifyRequest) => string | null;

/** Hostname sin puerto. Un `Host` IPv6 viene entre corchetes, como en una URL. */
function hostnameOf(raw: string): string {
	const value = raw.trim().toLowerCase();
	if (value.startsWith("[")) return value.slice(1, value.indexOf("]"));
	return value.split(":")[0];
}

/**
 * Un `Host` que es una IP o `localhost` nombra a ESTE proceso, no a una aplicación: lo mandan las
 * sondas, el monitoreo y el `curl` de la máquina. Reenviarlos haría que preguntar por un nodo
 * conteste otro —y que `bun run dev` saliera a buscar un vecino cada vez que se abre localhost—.
 */
function isSelfAddressed(host: string): boolean {
	return !host || host === "localhost" || host.endsWith(".localhost") || /^[\d.]+$/.test(host) || host.includes(":");
}

/**
 * Reenvía a los nodos vecinos lo que este nodo no sabe servir.
 *
 * Dos motivos, y el segundo es el que el fan-out del bus no puede resolver:
 *
 * 1. **Vhost ajeno**: la request entró por acá (DNS con varios A records) pero el vhost lo sirve
 *    otro nodo. Se la pasa al vecino, prefiriendo el del mismo sitio.
 * 2. **Afinidad de conexión**: el túnel de Drive hace RPC contra UN dispositivo, y ese dispositivo
 *    tiene su canal abierto contra un nodo concreto. Da igual que la ruta exista acá: si la
 *    conexión no está en este proceso, la respuesta es "no está conectado". Por eso el desvío se
 *    consulta antes del matching local y no como último recurso.
 *
 * `kernelMode: 92` — después del gateway S3 (90) y antes del `listen()` de UIFederationService.
 * Inactivo salvo `ADC_CLUSTER_GATEWAY=true`: con un solo nodo arranca y no registra nada.
 */
export default class ClusterGatewayService extends BaseService {
	public readonly name = "ClusterGatewayService";

	#httpProvider: IHostBasedHttpProvider | null = null;
	#cluster: IClusterService | null = null;
	#picker: NodePicker | null = null;
	#proxy: StreamingProxyHandler | null = null;
	readonly #affinity = new Map<string, AffinityResolver>();

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		if (!clusterGatewayEnabled()) {
			this.logger.logInfo("[cluster-gw] ADC_CLUSTER_GATEWAY=false: este nodo no reenvía nada");
			return;
		}

		const httpProvider = this.getMyProvider<IHostBasedHttpProvider>("fastify-server");
		if (!httpProvider.setRequestForwarder || !httpProvider.servesHost) {
			this.logger.logWarn("[cluster-gw] el provider HTTP no soporta desvío entre nodos: gateway inactivo");
			return;
		}
		// Sin registro de nodos no hay vecinos ni afinidades que consultar, y reenviar sería adivinar.
		const cluster = this.tryGetMyService<IClusterService>("ClusterService");
		if (!cluster) {
			this.logger.logWarn("[cluster-gw] sin ClusterService: gateway inactivo");
			return;
		}

		this.#httpProvider = httpProvider;
		this.#cluster = cluster;
		this.#picker = new NodePicker(cluster, (message) => this.logger.logWarn(`[cluster-gw] no se pudo leer el registro de nodos: ${message}`));
		this.#proxy = createStreamingProxyHandler({
			label: "[cluster-gw]",
			logger: this.logger,
			errorCodes: { unavailable: "CLUSTER_NODE_UNREACHABLE", writeFailed: "CLUSTER_NODE_WRITE_FAILED" },
		});
		// La primera foto del registro se paga acá y no en la primera request desviada.
		await this.#picker.prime();
		httpProvider.setRequestForwarder((request, reply) => this.#forward(request, reply), this.name);
		this.logger.logOk(`[cluster-gw] activo: lo que este nodo no sirve se reenvía a sus vecinos (sitio ${cluster.self().site})`);
	}

	/**
	 * Engancha un extractor de afinidad. Es la puerta para los productores (túnel de Drive, SSE):
	 * mientras nadie llame a `ClusterService.claim`, `whereIs` devuelve `null` y todo sigue por la
	 * ruta normal, así que registrar de más nunca desvía de más.
	 */
	registerAffinityResolver(name: string, resolve: AffinityResolver): () => void {
		this.#affinity.set(name, resolve);
		return () => {
			this.#affinity.delete(name);
		};
	}

	/**
	 * Lo llama el provider por cada request, ANTES del matching local. `false` = seguí sin mí.
	 *
	 * **Sincrónico salvo que haya afinidad que consultar**, y sí por velocidad: esto corre en
	 * TODAS las requests que entran al proceso, también las que se sirven acá, así que un round trip
	 * a Redis para decidir sería latencia sobre el 100% del tráfico. Por eso la lista de nodos se lee
	 * en segundo plano. Esperar I/O acá no rompe nada más: que un `await` antes de consumir el cuerpo
	 * dejara las subidas en cero bytes era un diagnóstico equivocado (medido: 256 MB completos tras
	 * tres round trips previos al `hijack()`), y el `await whereIs(...)` de la afinidad ya lo hace.
	 */
	#forward(request: FastifyRequest, reply: FastifyReply): boolean | Promise<boolean> {
		const path = request.url.split("?")[0];
		if (NEVER_FORWARD.has(path)) return false;

		const host = hostnameOf(String(request.headers.host ?? ""));
		const servedHere = this.#httpProvider!.servesHost!(host);

		const forwardedBy = request.headers[FORWARDED_BY];
		if (forwardedBy) {
			// Ya viene reenviada: este nodo es el final del camino. O la sirve —aunque la afinidad
			// haya cambiado mientras volaba— o se corta acá; devolverla sería un ping-pong entre dos
			// nodos que no la quieren, y a 502 se le ve la causa.
			if (servedHere) return false;
			this.logger.logWarn(`[cluster-gw] bucle cortado: ${String(forwardedBy)} mandó ${request.method} ${host}${path} y este nodo tampoco lo sirve`);
			void reply.code(502).header("Cache-Control", "no-store").send({ error: "CLUSTER_GATEWAY_LOOP" });
			return true;
		}

		// Va antes del ruteo por vhost porque es el caso contrario: acá la request es de este nodo y
		// aun así hay que soltarla, porque el chunk que pide pertenece a otro build. Se limita a los
		// vhosts propios: uno ajeno ya se reenvía abajo, y pinnearlo por build podría mandarlo a un
		// nodo que tampoco lo sirve (502). Un `Host` que nombra al proceso —IP, localhost— es una
		// sonda o el `curl` de la máquina, no una sesión de navegación que fijar.
		if (servedHere && !isSelfAddressed(host)) {
			const pinned = this.#pickByBuild(request, reply, path);
			if (pinned) return this.#dispatch(request, reply, this.#stamp(pinned, request));
		}

		if (this.#affinity.size > 0) return this.#forwardWithAffinity(request, reply, host, path, servedHere);
		return this.#dispatch(request, reply, this.#pickByHost(request, host, path, servedHere));
	}

	/**
	 * Afinidad por `build-id`: fija la sesión de navegación a los artefactos con los que se cargó
	 * el documento, mientras los nodos no los tengan igualados.
	 *
	 * Los remotes de Module Federation se resuelven por vhost, así que el navegador pide el
	 * documento a un nodo y los chunks al que le toque: con builds distintos eso es un 404
	 * intermitente, el error más caro de diagnosticar de los que produce el multi-nodo.
	 *
	 * Reparto: el **documento** siempre sale de este nodo (y reescribe la cookie, así una recarga
	 * adopta el build nuevo), y sólo sus **sub-recursos** siguen a la cookie. La API queda afuera:
	 * no depende del bundle, y fijarla al nodo viejo sería mandarle tráfico de negocio al que está
	 * quedando atrás.
	 *
	 * Sin vecinos —un solo nodo— no hace absolutamente nada: ni cookie ni desvío.
	 */
	#pickByBuild(request: FastifyRequest, reply: FastifyReply, path: string): ProxyTarget | null {
		if (path.startsWith("/api/") || (request.method !== "GET" && request.method !== "HEAD")) return null;
		if (!this.#picker!.hasNeighbours()) return null;

		const own = buildId();
		const pinned = readBuildCookie(request);
		if (isDocumentRequest(request)) {
			if (pinned !== own) {
				const secure = String(request.headers["x-forwarded-proto"] ?? request.protocol ?? "http") === "https";
				void reply.header("Set-Cookie", buildCookieHeader(own, secure));
			}
			return null;
		}
		// Sin cookie no hay nada que fijar (y con la del propio build, tampoco): se sirve acá.
		if (!pinned || pinned === own) return null;
		return this.#picker!.byBuildId(pinned);
	}

	/** Camino con afinidad: es el único que sale del proceso (un `GET` a Redis por resolver). */
	async #forwardWithAffinity(request: FastifyRequest, reply: FastifyReply, host: string, path: string, servedHere: boolean): Promise<boolean> {
		const owner = await this.#affinityOwner(request);
		if (owner && owner !== nodeId()) {
			const target = this.#picker!.byId(owner);
			// El dueño de la afinidad se cayó (o no publicó cómo alcanzarlo): atender acá y fallar
			// con "el dispositivo no está conectado" es más honesto que apuntar a un nodo muerto.
			if (target) return this.#dispatch(request, reply, this.#stamp(target, request));
		}
		// La conexión es de este nodo: no hay nada que reenviar.
		if (owner) return false;
		return this.#dispatch(request, reply, this.#pickByHost(request, host, path, servedHere));
	}

	#dispatch(request: FastifyRequest, reply: FastifyReply, target: ProxyTarget | null): boolean {
		if (!target) return false;
		this.#proxy!(request, reply, target);
		return true;
	}

	#pickByHost(request: FastifyRequest, host: string, path: string, servedHere: boolean): ProxyTarget | null {
		if (servedHere || isSelfAddressed(host)) return null;
		// El vhost es ajeno, pero las rutas de la API no dependen del vhost: si este nodo tiene el
		// módulo cargado, contesta él. Reenviar acá le daría al vecino tráfico que no le hace falta
		// y —peor— sacaría de este proceso requests que el monitoreo cree que atendió.
		if (this.#httpProvider!.hasGlobalRoute?.(request.method, path)) return null;

		const target = this.#picker!.pickNeighbour();
		return target ? this.#stamp(target, request) : null;
	}

	/** Primer resolver que reconozca la request gana. */
	async #affinityOwner(request: FastifyRequest): Promise<string | null> {
		for (const [name, resolve] of this.#affinity) {
			let key: string | null = null;
			try {
				key = resolve(request);
			} catch (error) {
				this.logger.logDebug(`[cluster-gw] el resolver "${name}" falló: ${(error as Error).message}`);
			}
			if (!key) continue;
			const owner = await this.#cluster!.whereIs(key);
			if (owner) return owner;
		}
		return null;
	}

	/**
	 * Sella la request saliente. `X-ADC-Forwarded-By` corta bucles; `X-Forwarded-For` es lo único
	 * que le deja ver al vecino la IP del cliente real — y sólo la va a creer si las IPs de los
	 * nodos están en su `TRUSTED_PROXIES` (si no, todos los reenvíos comparten bucket de rate limit
	 * y los bans por IP terminan baneando al nodo).
	 */
	#stamp(target: ProxyTarget, request: FastifyRequest): ProxyTarget {
		const previous = request.headers["x-forwarded-for"];
		// El salto anterior lo aporta el peer TCP, no `request.ip`: éste ya viene resuelto contra la
		// cadena y duplicaría al cliente en la primera posición.
		const chain = [Array.isArray(previous) ? previous.join(", ") : previous, request.raw.socket?.remoteAddress].filter(Boolean).join(", ");
		return {
			...target,
			headers: {
				[FORWARDED_BY]: nodeId(),
				...(chain ? { "x-forwarded-for": chain } : {}),
				"x-forwarded-proto": String(request.headers["x-forwarded-proto"] ?? request.protocol ?? "http"),
			},
		};
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		this.#httpProvider?.setRequestForwarder?.(null, this.name);
		this.#affinity.clear();
		this.#httpProvider = null;
		this.#cluster = null;
		this.#picker = null;
		this.#proxy = null;
		await super.stop(kernelKey);
	}
}
