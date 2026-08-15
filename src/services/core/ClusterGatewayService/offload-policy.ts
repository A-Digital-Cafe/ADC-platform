import type { ClusterNode } from "@common/types/cluster/ICluster.ts";
import { pressure } from "@common/utils/load-signal.ts";
import { nodeSite } from "@common/utils/cluster-env.ts";
import type { FastifyRequest } from "@interfaces/modules/providers/IHttpServer.js";

/**
 * Reparto de carga sin balanceador: cuándo este nodo le pasa una request a un vecino **porque no da
 * abasto**, y no porque le toque el turno.
 *
 * La condición es presión y no tipo de request, en tres pasos y en este orden: este nodo retrasado
 * (`highWater`), un vecino sensiblemente menos cargado (`margin`) y una ruta que cueste lo bastante
 * (`minRouteMs`). El porqué de cada uno, y por qué con un balanceador adelante no hay nada que
 * apagar, en «Reparto de carga sin balanceador» de `docs/guides/network-vpn.md`.
 */

export interface OffloadConfig {
	enabled: boolean;
	/** Presión (0-100) a partir de la cual este nodo se considera retrasado. */
	highWater: number;
	/** Cuánta menos presión tiene que tener el vecino para que el desvío tenga sentido. */
	margin: number;
	/** Costo típico mínimo de la ruta, en ms, para que el salto valga la pena. */
	minRouteMs: number;
	/** `true` = también a vecinos de otro sitio. Cruzar el WAN rara vez compensa. */
	crossSite: boolean;
}

export const DEFAULT_OFFLOAD: OffloadConfig = { enabled: true, highWater: 60, margin: 25, minRouteMs: 25, crossSite: false };

export function readOffloadConfig(raw: Record<string, unknown> | undefined): OffloadConfig {
	const num = (value: unknown, fallback: number): number => {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	};
	const highWater = Math.min(100, Math.max(1, num(raw?.highWater, DEFAULT_OFFLOAD.highWater)));
	return {
		enabled: String(raw?.enabled ?? "true").toLowerCase() !== "false",
		highWater,
		// El margen se acota a `highWater - 1`: con `margin >= highWater` el vecino tendría que
		// reportar carga NEGATIVA para calificar, y la política quedaría apagada por una combinación
		// de dos números que por separado no se ven mal.
		margin: Math.max(1, Math.min(highWater - 1, num(raw?.margin, DEFAULT_OFFLOAD.margin))),
		minRouteMs: Math.max(0, num(raw?.minRouteMs, DEFAULT_OFFLOAD.minRouteMs)),
		crossSite: String(raw?.crossSite ?? "false").toLowerCase() === "true",
	};
}

/** Peso de la muestra nueva en el costo por ruta. */
const ALPHA = 0.2;
/** Techo de rutas distintas recordadas: una API con ids en el path no puede hacer crecer esto sin fin. */
const MAX_ROUTES = 500;

/**
 * Bucket de costo de una request: `POST /api/drive/files/abc123` → `POST /api/drive`. Por ruta
 * exacta el mapa se llenaría de entradas de una sola muestra, inútiles para estimar un costo típico.
 */
function bucketOf(method: string, path: string): string {
	const segments = path.split("/").filter(Boolean).slice(0, 2);
	return `${method} /${segments.join("/")}`;
}

export class OffloadPolicy {
	readonly #config: OffloadConfig;
	/** Costo típico por bucket, en ms (media móvil). */
	readonly #cost = new Map<string, number>();
	#offloaded = 0;

	constructor(config: OffloadConfig) {
		this.#config = config;
	}

	get enabled(): boolean {
		return this.#config.enabled;
	}

	/** Cuántas requests se desviaron por carga desde que arrancó el proceso (diagnóstico). */
	get offloadedCount(): number {
		return this.#offloaded;
	}

	/** Registra cuánto tardó una request servida ACÁ. Es de dónde sale el costo típico de cada ruta. */
	record(method: string, path: string, elapsedMs: number): void {
		const key = bucketOf(method, path);
		const previous = this.#cost.get(key);
		if (previous === undefined && this.#cost.size >= MAX_ROUTES) return;
		this.#cost.set(key, previous === undefined ? elapsedMs : ALPHA * elapsedMs + (1 - ALPHA) * previous);
	}

	/**
	 * Costo típico de esa ruta, o `null` si todavía no hay muestras. Sin muestras **no se desvía**:
	 * sería apostar a que la request es cara, y la apuesta se paga con latencia.
	 */
	costOf(method: string, path: string): number | null {
		return this.#cost.get(bucketOf(method, path)) ?? null;
	}

	/**
	 * Vecino al que conviene pasarle esta request, o `null` para atenderla acá. `candidates` ya viene
	 * filtrada por el picker (vivos, alcanzables, no en espera): acá sólo se decide por carga.
	 */
	pick(request: FastifyRequest, path: string, candidates: ClusterNode[]): ClusterNode | null {
		if (!this.#config.enabled || candidates.length === 0) return null;

		// Un SSE o un upgrade a websocket abre un canal que vive minutos: desviarlo mueve el estado de
		// esa conexión fuera de donde el resto del proceso lo va a buscar.
		const accept = String(request.headers.accept ?? "");
		if (accept.includes("text/event-stream") || request.headers.upgrade) return null;

		const local = pressure();
		if (local < this.#config.highWater) return null;

		const cost = this.costOf(request.method, path);
		if (cost === null || cost < this.#config.minRouteMs) return null;

		const site = nodeSite();
		const pool = this.#config.crossSite ? candidates : candidates.filter((node) => node.site === site);

		let best: ClusterNode | null = null;
		let bestLoad = local - this.#config.margin;
		for (const node of pool) {
			// Un vecino que no publica su carga es desconocido, no libre: darle tráfico por no saber
			// es cómo se sobrecarga al que ya estaba peor.
			const load = node.load;
			if (typeof load !== "number") continue;
			if (load <= bestLoad) {
				best = node;
				bestLoad = load;
			}
		}
		if (best) this.#offloaded++;
		return best;
	}

	/** Lo que el panel puede mostrar sin exponer el mapa entero. */
	snapshot(): { enabled: boolean; pressure: number; offloaded: number; routes: number } {
		return { enabled: this.#config.enabled, pressure: pressure(), offloaded: this.#offloaded, routes: this.#cost.size };
	}
}
