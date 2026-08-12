import type RedisProvider from "../../../providers/queue/redis/index.ts";
import type { ClusterNode } from "@common/types/cluster/ICluster.ts";

/**
 * Registro de nodos vivos, en Redis.
 *
 * Es un **directorio con vencimiento**, no una fuente de verdad: cada nodo publica su propia
 * entrada con TTL y la refresca; el que se cae desaparece solo. No hay baja explícita que pueda
 * quedar a medias ni estado que reconciliar, que es justo lo que se quiere de un descubrimiento.
 *
 * Se usa un hash por nodo (`node:<id>`) en vez de un único hash con todos: un `HSET` compartido no
 * tiene TTL por campo, así que un nodo muerto se quedaría dentro para siempre.
 */
export class NodeRegistry {
	readonly #redis: RedisProvider;
	readonly #ttlSeconds: number;

	constructor(redis: RedisProvider, ttlSeconds: number) {
		this.#redis = redis;
		this.#ttlSeconds = ttlSeconds;
	}

	static #key(id: string): string {
		return `node:${id}`;
	}

	/** Publica/refresca la entrada de este nodo. Se llama en cada latido. */
	async announce(node: ClusterNode): Promise<void> {
		await this.#redis.setex(NodeRegistry.#key(node.id), this.#ttlSeconds, JSON.stringify(node));
	}

	/** Retira la entrada al apagar el nodo, para no esperar el TTL. */
	async withdraw(id: string): Promise<void> {
		await this.#redis.del(NodeRegistry.#key(id));
	}

	/**
	 * Nodos vivos. Usa `scan` y no `keys`: `keys` bloquea el servidor, y aunque con tres nodos dé
	 * igual, es el tipo de detalle que deja de dar igual sin que nadie lo note.
	 */
	async list(): Promise<ClusterNode[]> {
		const keys: string[] = [];
		let cursor = 0;
		do {
			const [next, batch] = await this.#redis.scan(cursor, "node:*", 100);
			keys.push(...batch);
			cursor = Number(next);
		} while (cursor !== 0);

		const nodes: ClusterNode[] = [];
		for (const key of keys) {
			// `scan` devuelve la clave CON el prefijo del provider, pero `get` lo vuelve a
			// anteponer: hay que sacárselo o se busca `adc:cluster:adc:cluster:node:x`.
			const raw = await this.#redis.get(key.replace(/^adc:cluster:/, ""));
			if (!raw) continue;
			try {
				nodes.push(JSON.parse(raw) as ClusterNode);
			} catch {
				/* entrada corrupta: se ignora, el TTL la limpia */
			}
		}
		return nodes.sort((a, b) => a.id.localeCompare(b.id));
	}
}
