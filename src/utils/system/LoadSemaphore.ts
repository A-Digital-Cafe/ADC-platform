import * as os from "node:os";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { MemoryProbe } from "./MemoryProbe.ts";

/** Colchón por debajo del cual se corta a un solo trabajo en vuelo. */
const HARD_RESERVE_BYTES = 512 * 1024 * 1024;
/** Por debajo del doble del colchón se corre a media máquina. */
const SOFT_RESERVE_BYTES = HARD_RESERVE_BYTES * 2;
/** % de tiempo estancado en memoria (PSI avg10) a partir del cual se frena. */
const PSI_BRAKE = 10;
/** Un trabajo que sigue vivo a los 90 s se avisa; NUNCA se libera su slot a la fuerza. */
const SLOW_TASK_MS = 90_000;
const SAMPLE_INTERVAL_MS = 2000;

export type LoadBrake = "none" | "psi" | "mem-soft" | "mem" | "throttled";

export interface LoadSemaphoreStats {
	ceiling: number;
	inFlight: number;
	queued: number;
	availableBytes: number | null;
	psiAvg10: number | null;
	brake: LoadBrake;
}

/**
 * Semáforo FIFO con freno por presión de memoria para acotar cuántas unidades de carga
 * pesada (una app y su cadena de bundlers) corren a la vez.
 *
 * Tres invariantes que lo hacen seguro por construcción:
 *
 *  1. **`ceiling >= 1` siempre.** El peor caso degrada exactamente al comportamiento
 *     serial de hoy, así que ninguna configuración de sonda puede colgar el arranque.
 *  2. **Nunca preempta.** No se puede des-spawnear un hijo de bundler, y liberar un slot
 *     cuyo hijo sigue residente rompe la cota. Un trabajo lento emite WARN con su nombre.
 *  3. **El techo se recalcula también por sampler**, no sólo al liberar: una cola frenada
 *     por presión tiene que poder reabrir sin depender de que alguien termine.
 */
export class LoadSemaphore {
	readonly #maxParallel: number;
	readonly #probe: MemoryProbe;
	readonly #logger: ILogger;
	readonly #queue: (() => void)[] = [];
	readonly #slowTimers = new Map<symbol, NodeJS.Timeout>();
	#inFlight = 0;
	#ceiling: number;
	#brake: LoadBrake = "none";
	#availableBytes: number | null = null;
	#psiAvg10: number | null = null;
	#sampler: NodeJS.Timeout | null = null;

	constructor(opts: { maxParallel: number; probe: MemoryProbe; logger: ILogger }) {
		this.#maxParallel = Math.max(1, opts.maxParallel);
		this.#probe = opts.probe;
		this.#logger = opts.logger;
		this.#ceiling = this.#maxParallel;
		this.#sampler = setInterval(() => {
			this.#recalculate();
			this.#drain();
		}, SAMPLE_INTERVAL_MS).unref();
	}

	/**
	 * Techo por defecto: 4, acotado por la paralelidad real de la máquina menos un hilo
	 * para el propio kernel. No es un número inventado — la capa `src/apps/public` ya
	 * spawnea 4 hijos simultáneos hoy sin problema. `BOOT_MAX_PARALLEL` lo pisa, y
	 * `BOOT_MAX_PARALLEL=1` restaura el timing serial exacto de antes.
	 */
	static defaultMaxParallel(): number {
		const override = Number(process.env.BOOT_MAX_PARALLEL);
		if (Number.isFinite(override) && override >= 1) return Math.floor(override);
		return Math.max(1, Math.min(4, os.availableParallelism() - 1));
	}

	get stats(): LoadSemaphoreStats {
		return {
			ceiling: this.#ceiling,
			inFlight: this.#inFlight,
			queued: this.#queue.length,
			availableBytes: this.#availableBytes,
			psiAvg10: this.#psiAvg10,
			brake: this.#brake,
		};
	}

	/** Adquiere un slot, corre `fn` y libera en `finally` (también si `fn` lanza). */
	async run<T>(label: string, fn: () => Promise<T>): Promise<T> {
		await this.#acquire();
		const ticket = Symbol(label);
		this.#slowTimers.set(
			ticket,
			setTimeout(() => this.#logger.logWarn(`[boot] ${label} sigue cargando tras ${SLOW_TASK_MS / 1000}s (no se libera su slot).`), SLOW_TASK_MS)
		);
		try {
			return await fn();
		} finally {
			const timer = this.#slowTimers.get(ticket);
			if (timer) clearTimeout(timer);
			this.#slowTimers.delete(ticket);
			this.#release();
		}
	}

	dispose(): void {
		if (this.#sampler) clearInterval(this.#sampler);
		this.#sampler = null;
		for (const timer of this.#slowTimers.values()) clearTimeout(timer);
		this.#slowTimers.clear();
	}

	#acquire(): Promise<void> {
		this.#recalculate();
		if (this.#inFlight < this.#ceiling) {
			this.#inFlight++;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.#queue.push(() => {
				this.#inFlight++;
				resolve();
			});
		});
	}

	#release(): void {
		this.#inFlight--;
		this.#recalculate();
		this.#drain();
	}

	#drain(): void {
		while (this.#queue.length > 0 && this.#inFlight < this.#ceiling) {
			this.#queue.shift()?.();
		}
	}

	#recalculate(): void {
		this.#availableBytes = this.#probe.availableBytes();
		this.#psiAvg10 = this.#probe.pressureAvg10();
		const previous = this.#brake;

		if (this.#probe.throttledSinceLastCheck()) this.#brake = "throttled";
		else if (this.#psiAvg10 !== null && this.#psiAvg10 >= PSI_BRAKE) this.#brake = "psi";
		else if (this.#availableBytes !== null && this.#availableBytes < HARD_RESERVE_BYTES) this.#brake = "mem";
		else if (this.#availableBytes !== null && this.#availableBytes < SOFT_RESERVE_BYTES) this.#brake = "mem-soft";
		else this.#brake = "none";

		this.#ceiling = this.#brake === "none" ? this.#maxParallel : this.#brake === "mem-soft" ? Math.max(1, Math.floor(this.#maxParallel / 2)) : 1;

		if (previous !== this.#brake) {
			const mib = this.#availableBytes === null ? "?" : Math.round(this.#availableBytes / 1024 / 1024);
			this.#logger.logDebug(`[boot] freno de carga: ${previous} → ${this.#brake} (techo ${this.#ceiling}, disponible ${mib} MiB)`);
		}
	}
}
