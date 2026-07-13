import type { ILogger } from "../../interfaces/utils/ILogger.js";

export interface CircuitBreakerOptions {
	/** Intervalo entre reintentos rápidos (circuito cerrado). */
	shortMs: number;
	/** Reintentos rápidos antes de abrir el circuito. */
	maxShort: number;
	/** Intervalo entre reintentos una vez abierto el circuito. */
	longMs: number;
	logger: ILogger;
	/** Se invoca UNA sola vez por episodio de fallos, al abrir el circuito. */
	onOpen?: (key: string, lastError: string) => void;
}

interface BreakerEntry {
	failures: number;
	open: boolean;
	timer: NodeJS.Timeout | null;
}

/**
 * Circuit breaker de reintentos de módulos: `maxShort` reintentos con intervalo
 * corto y, agotados, uno por intervalo largo (algo caído que no vuelve rápido no
 * merece un retry frecuente para siempre). `schedule` re-agenda sólo si `task`
 * vuelve a rechazar; `clear` cancela el reintento pendiente y olvida el historial
 * (corrida estable, unload/reload o disable del módulo). Los timers van con
 * `unref` para no retener el proceso en el shutdown.
 */
export class CircuitBreaker {
	readonly #entries = new Map<string, BreakerEntry>();
	readonly #opts: Readonly<CircuitBreakerOptions>;

	constructor(opts: CircuitBreakerOptions) {
		this.#opts = Object.freeze({ ...opts });
	}

	/** Agenda un reintento de `task` para `key`. No-op si ya hay uno pendiente. */
	schedule(key: string, lastError: string, task: () => Promise<void>): void {
		let entry = this.#entries.get(key);
		if (!entry) {
			entry = { failures: 0, open: false, timer: null };
			this.#entries.set(key, entry);
		}
		if (entry.timer) return;
		entry.failures++;
		if (!entry.open && entry.failures > this.#opts.maxShort) {
			entry.open = true;
			this.#opts.logger.logWarn(
				`Circuito abierto para ${key} tras ${this.#opts.maxShort} reintentos fallidos: se reintentará cada ${Math.round(this.#opts.longMs / 60_000)} min.`
			);
			this.#opts.onOpen?.(key, lastError);
		}
		const delay = entry.open ? this.#opts.longMs : this.#opts.shortMs;
		this.#opts.logger.logInfo(`Reintento ${entry.failures} de ${key} en ${Math.round(delay / 1000)}s...`);
		entry.timer = setTimeout(() => {
			entry.timer = null;
			task().catch((e: unknown) => this.schedule(key, e instanceof Error ? e.message : String(e), task));
		}, delay);
		entry.timer.unref?.();
	}

	/** Cancela el reintento pendiente de `key` y resetea su historial de fallos. */
	clear(key: string): void {
		const entry = this.#entries.get(key);
		if (!entry) return;
		if (entry.timer) clearTimeout(entry.timer);
		this.#entries.delete(key);
	}
}
