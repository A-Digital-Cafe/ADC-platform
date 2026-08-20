import { BaseService } from "../../BaseService.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import type RedisProvider from "../../../providers/queue/redis/index.ts";
import type RabbitMQProvider from "../../../providers/queue/rabbitmq/index.ts";
import type { IHostBasedHttpProvider } from "@interfaces/modules/providers/IHttpServer.js";
import type { ClusterEvent, ClusterEventHandler, ClusterNode, IClusterService } from "@common/types/cluster/ICluster.ts";
import { advertisedAddress, isPrimary, nodeId, nodeName, nodeRole, nodeSite, siteName } from "@common/utils/cluster-env.ts";
import { buildId, refreshBuildId } from "@common/utils/build-id.ts";
import { NodeRegistry } from "./registry.js";
import { BuildTarget } from "./build-target.js";
import { registerHealthRoute } from "./health.js";
import { powerMode } from "@common/utils/node-state.ts";
import { pressure, startLoadSampler } from "@common/utils/load-signal.ts";

/** Exchange del bus. No durable: el porqué está en `helpers/fanout.ts` del provider. */
const CLUSTER_EXCHANGE = "cluster.fanout";

/**
 * Descubrimiento y coordinación entre nodos.
 *
 * Tres cosas que sólo tienen sentido juntas:
 *
 * 1. **Registro**: cada nodo publica su entrada con TTL y la refresca. El que se cae desaparece
 *    solo; no hay baja explícita que pueda quedar a medias.
 * 2. **Bus**: avisos efímeros entre procesos vivos (invalidar una caché, empujar una notificación
 *    al nodo que sostiene la conexión SSE del usuario).
 * 3. **Afinidad**: qué nodo sostiene la conexión de un recurso, para poder reenviarle el request
 *    en vez de contestar desde uno que no la tiene.
 * 4. **Artefactos**: qué build de UI sirve cada nodo y cuál debería servir la flota, que es lo que
 *    saca de rotación al nodo que quedó atrás en un deploy.
 *
 * `kernelMode: 40` — antes de `OperationsService` (45), porque a partir de ahí ya hay servicios
 * que quieren saber en qué nodo corren.
 *
 * **Con un solo nodo funciona igual y no molesta**: el registro tiene una entrada, el bus no
 * entrega a nadie (el emisor nunca recibe su propio eco) y la afinidad siempre resuelve a sí mismo.
 */
export default class ClusterService extends BaseService implements IClusterService {
	public readonly name = "ClusterService";

	#redis: RedisProvider | null = null;
	#rabbit: RabbitMQProvider | null = null;
	#httpProvider: IHostBasedHttpProvider | null = null;
	#registry: NodeRegistry | null = null;
	#buildTarget: BuildTarget | null = null;
	#heartbeat: ReturnType<typeof setInterval> | null = null;
	#ready = false;
	#draining = false;
	#bootedAt = new Date().toISOString();
	#buildId = buildId();
	/** Última transición de artefactos ya avisada, para no repetir el mismo warn en cada latido. */
	#staleLogged = false;
	readonly #handlers = new Map<string, Set<ClusterEventHandler<any>>>();

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		const cfg = (this.config?.private ?? {}) as { heartbeatSeconds?: string; nodeTtlSeconds?: string };
		const heartbeatMs = Math.max(1, Number(cfg.heartbeatSeconds) || 10) * 1000;
		const ttlSeconds = Math.max(2, Number(cfg.nodeTtlSeconds) || 30);

		this.#redis = this.getMyProvider<RedisProvider>("queue/redis");
		this.#registry = new NodeRegistry(this.#redis, ttlSeconds);
		this.#buildTarget = new BuildTarget(this.#redis);
		// El muestreo de presión arranca con el clúster porque es acá donde se publica: sin
		// vecinos a quien contárselo, medirlo sería trabajo sin lector.
		startLoadSampler();
		this.#httpProvider = this.getMyProvider<IHostBasedHttpProvider>("fastify-server");
		registerHealthRoute(this.#httpProvider, this.name, () => ({
			ready: this.#ready,
			draining: this.#draining,
			standby: powerMode() === "standby",
			buildId: this.#buildId,
			expectedBuildId: this.#buildTarget?.expected() ?? null,
		}));

		await this.#announce();
		this.#heartbeat = setInterval(() => {
			this.#announce().catch((error) => this.logger.logDebug(`[cluster] latido fallido: ${(error as Error).message}`));
		}, heartbeatMs);
		this.#heartbeat.unref?.();

		await this.#connectBus();

		// El nodo se declara listo cuando el kernel terminó de arrancar, no acá: `/healthz` es lo
		// que mira un balanceador para mandarle tráfico, y mandárselo a mitad del arranque es
		// exactamente lo que hay que evitar.
		this.logger.logOk(`[cluster] nodo "${nodeName()}" (${nodeId()}) registrado en el sitio ${nodeSite()} con el build ${this.#buildId}`);
	}

	/** Lo llama el kernel al terminar de arrancar. Hasta entonces `/healthz` responde 503. */
	markReady(): void {
		this.#ready = true;
		void this.#announce();
	}

	/**
	 * **Primer paso del cierre ordenado**, antes de parar una sola app: saca al nodo de rotación y
	 * lo borra del registro, para que ni el balanceador ni el gateway de un vecino le sigan mandando
	 * tráfico mientras se apaga.
	 *
	 * Es un paso propio y no parte de `stop()`, que llega tarde: `ModuleRegistry` para providers
	 * antes que services, así que Redis ya cerró y el `withdraw()` falla en silencio (ver
	 * `KernelShutdown`). **Corta el latido primero**: al revés, el siguiente `#announce()` volvería a
	 * registrar el nodo recién dado de baja.
	 *
	 * Idempotente y no lanza: es la primera línea de un cierre y no puede ser el motivo de que falle.
	 */
	async beginDrain(): Promise<void> {
		if (this.#draining) return;
		this.#draining = true;
		if (this.#heartbeat) clearInterval(this.#heartbeat);
		this.#heartbeat = null;
		try {
			await this.#registry?.withdraw(nodeId());
			this.logger.logInfo(`[cluster] nodo "${nodeName()}" fuera de rotación: /healthz responde 503 (draining)`);
		} catch (error) {
			this.logger.logWarn(`[cluster] no se pudo dar de baja el nodo del registro: ${(error as Error).message}`);
		}
	}

	self(): ClusterNode {
		return {
			id: nodeId(),
			displayName: nodeName(),
			site: nodeSite(),
			siteName: siteName(),
			role: nodeRole(),
			advertise: advertisedAddress(),
			buildId: this.#buildId,
			bootedAt: this.#bootedAt,
			version: process.env.npm_package_version ?? "0.0.0",
			ready: this.#ready,
			power: powerMode(),
			load: pressure(),
		};
	}

	async nodes(): Promise<ClusterNode[]> {
		if (!this.#registry) return [this.self()];
		try {
			const nodes = await this.#registry.list();
			// El propio nodo siempre aparece, aunque Redis esté caído o su entrada haya vencido:
			// una lista que no se incluye a sí misma se lee como "el clúster está vacío".
			return nodes.some((n) => n.id === nodeId()) ? nodes : [this.self(), ...nodes];
		} catch (error) {
			this.logger.logWarn(`[cluster] no se pudo listar nodos: ${(error as Error).message}`);
			return [this.self()];
		}
	}

	async #announce(): Promise<void> {
		// El `build-id` se recalcula acá y no una sola vez al arrancar: un deploy mueve el sha sin
		// reiniciar el proceso, y publicar el viejo dejaría al nodo diciendo que sirve algo que ya
		// no sirve —o peor, tapando que sus vecinos quedaron atrás—.
		const current = refreshBuildId();
		if (current !== this.#buildId) {
			this.logger.logInfo(`[cluster] los artefactos de UI cambiaron: build ${this.#buildId} → ${current}`);
			this.#buildId = current;
		}
		await this.#registry?.announce(this.self());
		// Sólo el primario publica el build vigente: es el nodo desde el que se despliega, así que
		// es el único que sabe cuál es el bueno. Los demás lo leen y se comparan.
		await this.#buildTarget?.sync(this.#buildId, isPrimary());
		this.#logBuildDrift();
	}

	/** Avisa una sola vez por transición: en cada latido sería ruido, y sin aviso el 503 no se explica. */
	#logBuildDrift(): void {
		const expected = this.#buildTarget?.expected() ?? null;
		const stale = expected !== null && expected !== this.#buildId;
		if (stale === this.#staleLogged) return;
		this.#staleLogged = stale;
		if (stale) {
			this.logger.logWarn(
				`[cluster] este nodo sirve el build ${this.#buildId} y la flota espera ${expected}: ` +
					`/healthz responde 503 (stale-build) hasta actualizarlo, para que el balanceador no le mande tráfico.`
			);
		} else {
			this.logger.logOk(`[cluster] artefactos al día (${this.#buildId}): el nodo vuelve a recibir tráfico`);
		}
	}

	// ── Bus ───────────────────────────────────────────────────────────────────

	async #connectBus(): Promise<void> {
		// RabbitMQ es OPCIONAL a propósito: sin él la plataforma sigue funcionando y sólo pierde
		// el fan-out entre nodos, que con un nodo no hace nada. Exigirlo convertiría un broker
		// caído en un arranque fallido.
		this.#rabbit = this.tryGetMyProvider<RabbitMQProvider>("queue/rabbitmq") ?? null;
		if (!this.#rabbit) {
			this.logger.logInfo("[cluster] sin RabbitMQ: el bus entre nodos queda deshabilitado (irrelevante con un solo nodo).");
			return;
		}
		try {
			// El pid va en el nombre porque la cola es exclusiva de la conexión: dos procesos en la
			// misma máquina (un dev server que todavía no murió y el que arranca) comparten `nodeId()`
			// y el segundo se comía un RESOURCE_LOCKED. El nombre no lo usa nadie más: lo que importa
			// es el binding al fanout.
			const queue = `q.cluster.${nodeId()}.${process.pid}`;
			this.#rabbit.createFanoutConsumer(
				CLUSTER_EXCHANGE,
				queue,
				async (body) => {
					await this.#dispatch(body as ClusterEvent);
				},
				(err) => this.logger.logWarn(`[cluster] el consumer del bus falló: ${err.message}`)
			);
			this.logger.logOk(`[cluster] bus conectado (${CLUSTER_EXCHANGE})`);
		} catch (error) {
			this.logger.logWarn(`[cluster] no se pudo conectar el bus: ${(error as Error).message}`);
			this.#rabbit = null;
		}
	}

	async #dispatch(event: ClusterEvent): Promise<void> {
		// Descarta el eco propio ANTES de mirar handlers: un fanout entrega también al emisor, y
		// una invalidación que se re-emite a sí misma es un bucle que no se nota hasta que arde.
		if (!event?.topic || event.origin === nodeId()) return;
		for (const handler of this.#handlers.get(event.topic) ?? []) {
			try {
				await handler(event);
			} catch (error) {
				this.logger.logWarn(`[cluster] handler de "${event.topic}" falló: ${(error as Error).message}`);
			}
		}
	}

	async publish<T>(topic: string, payload: T): Promise<void> {
		if (!this.#rabbit) return;
		const event: ClusterEvent<T> = { topic, origin: nodeId(), payload };
		try {
			await this.#rabbit.publishFanout(CLUSTER_EXCHANGE, event as unknown as Record<string, unknown>);
		} catch (error) {
			this.logger.logWarn(`[cluster] no se pudo publicar "${topic}": ${(error as Error).message}`);
		}
	}

	subscribe<T>(topic: string, handler: ClusterEventHandler<T>): () => void {
		const set = this.#handlers.get(topic) ?? new Set();
		set.add(handler as ClusterEventHandler<any>);
		this.#handlers.set(topic, set);
		return () => {
			set.delete(handler as ClusterEventHandler<any>);
			if (set.size === 0) this.#handlers.delete(topic);
		};
	}

	// ── Afinidad de conexiones ────────────────────────────────────────────────

	async whereIs(resource: string): Promise<string | null> {
		if (!this.#redis) return null;
		return this.#redis.get(`where:${resource}`);
	}

	async claim(resource: string, ttlSeconds: number): Promise<void> {
		// `setex` y no `setIfAbsent`: reclamar es "esta conexión la tengo YO ahora". Si el usuario
		// se reconecta a otro nodo, el nuevo tiene que ganar; no hay nada que proteger de carreras.
		await this.#redis?.setex(`where:${resource}`, ttlSeconds, nodeId());
	}

	async release(resource: string): Promise<void> {
		// Sólo suelta lo que sigue siendo suyo: si el usuario ya se reconectó a otro nodo, el
		// cierre tardío de la conexión vieja no debe borrar la afinidad nueva.
		if ((await this.whereIs(resource)) === nodeId()) await this.#redis?.del(`where:${resource}`);
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		// La baja del registro vive en `beginDrain()`, que el cierre ordenado llama al principio.
		// Acá se repite por si se para el servicio por otra vía (recarga de módulo, `disable` del
		// panel): es idempotente, y en ese camino el provider de Redis todavía está vivo.
		await this.beginDrain();
		this.#ready = false;
		this.#httpProvider?.unregisterRoutesByOwner?.(this.name);
		this.#handlers.clear();
		this.#buildTarget = null;
		this.#registry = null;
		this.#redis = null;
		this.#rabbit = null;
		this.#httpProvider = null;
		await super.stop(kernelKey);
	}
}
