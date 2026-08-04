import * as fs from "node:fs";
import * as path from "node:path";
import { Logger } from "../logger/Logger.js";
import type { ILogger } from "../../interfaces/utils/ILogger.js";

/**
 * Instrumentación del arranque: mide fases con `performance.now()` y muestrea la RSS
 * de los procesos hijos de bundler.
 *
 * Existe porque la única señal previa era el reloj de segundos de `ConsoleLogger`, que
 * no distingue un `setTimeout(5000)` de un compile real de 4 s — y el arranque está
 * dominado justo por esa diferencia.
 *
 * Salida:
 *  - una línea `BOOT-PHASE <nombre> <ms>` por fase (nivel DEBUG, para no ensuciar el boot);
 *  - un resumen INFO con el total y las fases más lentas al llamar `finish()`;
 *  - JSON Lines en `temp/boot-timings.jsonl` (siempre, para diffear entre corridas).
 *
 * Se apaga por completo con `ADC_BOOT_TIMELINE=false`.
 */

interface PhaseRecord {
	name: string;
	ms: number;
	at: number;
}

interface TrackedChild {
	pid: number;
	label: string;
	peakBytes: number;
}

const SAMPLE_INTERVAL_MS = 2000;
const SUMMARY_TOP = 8;
/** Tamaño de página asumido para `statm` (Linux: siempre 4 KiB en las arquitecturas que soportamos). */
const PAGE_SIZE = 4096;

class BootTimelineImpl {
	readonly #enabled: boolean;
	readonly #logger: ILogger = Logger.getLogger("BootTimeline");
	readonly #startedAt = performance.now();
	readonly #phases: PhaseRecord[] = [];
	readonly #children = new Map<number, TrackedChild>();
	#sampler: NodeJS.Timeout | null = null;
	#peakChildBytes = 0;
	#finished = false;
	/** Se abre en el primer uso; si el FS falla, la instrumentación se degrada a sólo logs. */
	#stream: fs.WriteStream | null = null;

	constructor() {
		this.#enabled = process.env.ADC_BOOT_TIMELINE !== "false";
	}

	/**
	 * Abre una fase y devuelve su cierre. El cierre es idempotente: llamarlo dos veces
	 * (p. ej. en un `finally` y en el camino feliz) no duplica la medición.
	 */
	phase(name: string): () => void {
		if (!this.#enabled) return () => {};
		const start = performance.now();
		let closed = false;
		return () => {
			if (closed) return;
			closed = true;
			this.#record(name, performance.now() - start);
		};
	}

	/** Envuelve una promesa en una fase (mide también el camino de error). */
	async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
		const end = this.phase(name);
		try {
			return await fn();
		} finally {
			end();
		}
	}

	/**
	 * Registra un hijo de bundler para muestrear su RSS. El sampler arranca con el
	 * primer hijo y se apaga en `finish()`; `unref()` para no sostener el event loop.
	 */
	trackChild(pid: number | undefined, label: string): void {
		if (!this.#enabled || !pid || this.#finished) return;
		this.#children.set(pid, { pid, label, peakBytes: 0 });
		this.#sampler ??= setInterval(() => this.#sample(), SAMPLE_INTERVAL_MS).unref();
	}

	/**
	 * Cierra la instrumentación: para el sampler, emite el resumen y cierra el archivo.
	 * Idempotente (el kernel puede llamarlo desde el boot y desde el shutdown).
	 */
	finish(): void {
		if (!this.#enabled || this.#finished) return;
		this.#finished = true;
		this.#sample();
		if (this.#sampler) clearInterval(this.#sampler);
		this.#sampler = null;

		const total = Math.round(performance.now() - this.#startedAt);
		const slowest = [...this.#phases]
			.sort((a, b) => b.ms - a.ms)
			.slice(0, SUMMARY_TOP)
			.map((p) => `${p.name} ${Math.round(p.ms)}ms`);
		this.#logger.logInfo(`BOOT-TOTAL ${total}ms | pico hijos ${this.#mib(this.#peakChildBytes)} MiB | top: ${slowest.join(", ")}`);
		this.#write({ kind: "boot", totalMs: total, peakChildBytes: this.#peakChildBytes, children: [...this.#children.values()] });
		this.#stream?.end();
		this.#stream = null;
	}

	#record(name: string, ms: number): void {
		this.#phases.push({ name, ms, at: Date.now() });
		this.#logger.logDebug(`BOOT-PHASE ${name} ${Math.round(ms)}ms`);
		this.#write({ kind: "phase", name, ms: Math.round(ms), at: Date.now() });
	}

	/**
	 * Cargo real por hijo desde `/proc/<pid>/statm` (campo 2 = páginas residentes).
	 * No usa el RSS del kernel: los bundlers son procesos aparte y su memoria no aparece ahí.
	 */
	#sample(): void {
		if (this.#children.size === 0) return;
		let live = 0;
		for (const child of this.#children.values()) {
			const bytes = this.#rssOf(child.pid);
			if (bytes === null) continue;
			live += bytes;
			if (bytes > child.peakBytes) child.peakBytes = bytes;
		}
		if (live > this.#peakChildBytes) this.#peakChildBytes = live;
	}

	#rssOf(pid: number): number | null {
		try {
			const statm = fs.readFileSync(`/proc/${pid}/statm`, "utf8");
			const resident = Number(statm.split(" ")[1]);
			return Number.isFinite(resident) ? resident * PAGE_SIZE : null;
		} catch {
			// Hijo ya muerto o plataforma sin procfs: no es un error, sólo no hay muestra.
			return null;
		}
	}

	#mib(bytes: number): number {
		return Math.round(bytes / 1024 / 1024);
	}

	#write(entry: Record<string, unknown>): void {
		try {
			if (!this.#stream) {
				const dir = path.resolve(process.cwd(), "temp");
				fs.mkdirSync(dir, { recursive: true });
				this.#stream = fs.createWriteStream(path.join(dir, "boot-timings.jsonl"), { flags: "a" });
				this.#stream.on("error", () => {
					this.#stream = null;
				});
			}
			this.#stream.write(`${JSON.stringify(entry)}\n`);
		} catch {
			/* la instrumentación nunca puede tumbar el boot */
		}
	}
}

/** Instancia única: el arranque es uno solo por proceso. */
export const bootTimeline = new BootTimelineImpl();
