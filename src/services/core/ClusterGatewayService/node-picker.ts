import type { ClusterNode, IClusterService } from "@common/types/cluster/ICluster.ts";
import type { ProxyTarget } from "@common/utils/http-proxy.ts";
import { nodeId, nodeSite } from "@common/utils/cluster-env.ts";

/**
 * Cada cuánto se relee el registro. El propio registro se refresca por latido cada ~10 s, así que
 * mirarlo más seguido no aporta nada; lo que importa es que **nunca se lee dentro de una request**.
 */
const REFRESH_MS = 2000;

/**
 * `host:puerto` → destino. Sin puerto no hay a dónde reenviar, así que el nodo queda fuera en vez
 * de inventarle un default. IPv6 va entre corchetes, como en una URL.
 */
export function parseAdvertise(advertise: string | null): ProxyTarget | null {
	const value = advertise?.trim();
	if (!value) return null;
	const bracketed = /^\[(.+)]:(\d+)$/.exec(value);
	const host = bracketed ? bracketed[1] : value.slice(0, value.lastIndexOf(":"));
	const port = Number(bracketed ? bracketed[2] : value.slice(value.lastIndexOf(":") + 1));
	if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
	return { host, port };
}

/**
 * Elige a qué vecino se le reenvía una request, **sin salir del proceso**.
 *
 * Que sea sincrónico es una optimización, y de las que valen: a esto lo consulta el gateway en cada
 * request que entra al proceso —incluidas las que termina sirviendo él—, así que preguntarle a
 * Redis por cada una sería sumarle un round trip al tráfico entero. La request usa siempre la
 * última foto conocida: a lo sumo unos segundos vieja, que es menos de lo que tarda el propio
 * latido en publicar un cambio.
 *
 * Dos filtros que no son negociables: **`ready`** —un nodo a medio arrancar contesta cualquier
 * cosa, por eso el registro publica el flag— y **`advertise`**, sin el cual no hay dirección. Y
 * nunca a sí mismo: reenviarse sería un bucle contra el propio proceso.
 */
export class NodePicker {
	readonly #cluster: IClusterService;
	readonly #onError: (message: string) => void;
	#snapshot: ClusterNode[] = [];
	#lastAt = 0;
	#refreshing = false;
	/** Cursor del reparto por turnos: sin él, todo el tráfico desviado cae siempre en el mismo vecino. */
	#cursor = 0;

	constructor(cluster: IClusterService, onError: (message: string) => void) {
		this.#cluster = cluster;
		this.#onError = onError;
	}

	/** Primera foto del registro, al arrancar. Hasta que llegue, este nodo no reenvía nada. */
	async prime(): Promise<void> {
		await this.#refresh();
	}

	async #refresh(): Promise<void> {
		if (this.#refreshing) return;
		this.#refreshing = true;
		try {
			this.#snapshot = await this.#cluster.nodes();
			this.#lastAt = Date.now();
		} catch (error) {
			// Se conserva la foto anterior: quedarse sin vecinos porque Redis parpadeó sería peor
			// que reenviarle a uno que quizá ya no está (ahí responde el 502 del propio proxy).
			this.#onError((error as Error).message);
		} finally {
			this.#refreshing = false;
		}
	}

	/** Foto vigente. Dispara el refresco en segundo plano; no lo espera nunca. */
	#candidates(): ClusterNode[] {
		if (Date.now() - this.#lastAt >= REFRESH_MS) void this.#refresh();
		// `power === "standby"` queda afuera igual que un nodo que no terminó de arrancar: está vivo
		// y en el registro, pero no cargó una sola app, así que reenviarle una request devolvería un
		// 404 en vez de la respuesta que ese nodo, encendido, sí sabría dar.
		return this.#snapshot.filter((node) => node.ready && node.power !== "standby" && node.id !== nodeId() && node.advertise);
	}

	/**
	 * Los vecinos elegibles, tal cual: vivos, alcanzables y no en espera.
	 *
	 * La expone para que la política de reparto por carga decida con la MISMA lista que usa el
	 * ruteo, en vez de releer el registro por su cuenta y poder discrepar sobre quién está vivo.
	 */
	candidates(): ClusterNode[] {
		return this.#candidates();
	}

	/** `true` si hay a quién reenviarle algo. Con un solo nodo apaga la afinidad por build. */
	hasNeighbours(): boolean {
		return this.#candidates().length > 0;
	}

	/**
	 * Un vecino que sirva EXACTAMENTE ese build, para los chunks de una sesión que empezó con él.
	 *
	 * Que un nodo esté drenado por `/healthz` (artefactos viejos) no lo excluye acá, y es a
	 * propósito: drenarlo significa que el balanceador no le manda **sesiones nuevas**, no que deje
	 * de servir los chunks de las que ya empezaron. Justo eso es lo que evita el 404 intermitente.
	 */
	byBuildId(buildId: string): ProxyTarget | null {
		for (const node of this.#candidates()) {
			if (node.buildId !== buildId) continue;
			const target = parseAdvertise(node.advertise);
			if (target) return target;
		}
		return null;
	}

	/** El nodo que reclamó una afinidad, si sigue vivo y en condiciones de recibir tráfico. */
	byId(id: string): ProxyTarget | null {
		const node = this.#candidates().find((candidate) => candidate.id === id);
		return node ? parseAdvertise(node.advertise) : null;
	}

	/**
	 * Un vecino capaz cualquiera. Entre dos que puedan, gana el del mismo sitio: cruzar el WAN por
	 * una request que un nodo de al lado atiende igual es la diferencia entre un milisegundo y
	 * doscientos.
	 */
	pickNeighbour(): ProxyTarget | null {
		const candidates = this.#candidates();
		const sameSite = candidates.filter((node) => node.site === nodeSite());
		const pool = sameSite.length > 0 ? sameSite : candidates;
		for (let i = 0; i < pool.length; i++) {
			const target = parseAdvertise(pool[(this.#cursor + i) % pool.length].advertise);
			if (target) {
				this.#cursor = (this.#cursor + i + 1) % pool.length;
				return target;
			}
		}
		return null;
	}
}
