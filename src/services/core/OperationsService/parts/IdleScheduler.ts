import type { ILogger } from "@interfaces/utils/ILogger.js";
import type { IdleJobDefinition, IdleJobStatus } from "@common/types/operations/IIdleOrchestrator.ts";
import { LoadSampler, type LoadThresholds } from "./LoadSampler.ts";

export interface SchedulerConfig extends LoadThresholds {
	/** Cada cuánto se mira si hay lugar para un lote. */
	tickMs: number;
	/** Default de `intervalMs` de un trabajo que no lo declara. */
	defaultIntervalMs: number;
	/** Default de `batchBudgetMs`. */
	defaultBatchBudgetMs: number;
	/** Tope del espaciado progresivo: sin él, un barrido al día quedaría esperando semanas. */
	maxBackoffMs: number;
	/** Fallos consecutivos tras los cuales se da de baja el trabajo (ver `#evictIfDead`). */
	maxConsecutiveFailures: number;
}

interface JobEntry {
	owner: string;
	job: IdleJobDefinition;
	intervalMs: number;
	batchBudgetMs: number;
	nextRunAt: number;
	idleRounds: number;
	running: boolean;
	lastRunAt: number | null;
	lastDurationMs: number | null;
	lastProcessed: number | null;
	totalProcessed: number;
	lastError: string | null;
	consecutiveFailures: number;
	abort: AbortController | null;
}

const key = (owner: string, id: string): string => `${owner}:${id}`;

/**
 * Planificador de trabajos de fondo. Cuatro reglas sostienen la promesa de "pasivo":
 *
 * 1. **Un lote por turno, nunca en paralelo** — dos barridos simultáneos son carga de primer plano.
 * 2. **No corre si el proceso no está ocioso** — bajo carga el turno se saltea; el trabajo se
 *    pospone, no se pierde.
 * 3. **Presupuesto por lote** (`AbortSignal`) — el avance lo persiste el trabajo, no el planificador.
 * 4. **Espaciado progresivo** — devolver `0` duplica la espera hasta `maxBackoffMs`, así que un
 *    sistema al día no paga por tener el barrido registrado.
 */
export class IdleScheduler {
	readonly #jobs = new Map<string, JobEntry>();
	readonly #sampler: LoadSampler;
	#timer: NodeJS.Timeout | null = null;
	#ticking = false;
	/** Índice del último trabajo elegido: reparte los turnos en round-robin. */
	#cursor = 0;

	constructor(
		private readonly config: SchedulerConfig,
		private readonly logger: ILogger
	) {
		this.#sampler = new LoadSampler(config);
	}

	start(): void {
		if (this.#timer) return;
		this.#timer = setInterval(() => void this.#tick(), this.config.tickMs);
		this.#timer.unref?.();
	}

	stop(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
		for (const entry of this.#jobs.values()) entry.abort?.abort();
	}

	register(owner: string, job: IdleJobDefinition): void {
		const id = job.id.trim();
		if (!id) throw new Error("un trabajo de fondo necesita un id");
		const k = key(owner, id);
		// Reemplazo, no duplicado: un hot reload re-registra lo mismo. Se aborta el lote en curso
		// del anterior, que apunta a código viejo.
		this.#jobs.get(k)?.abort?.abort();

		const intervalMs = Math.max(1000, job.intervalMs ?? this.config.defaultIntervalMs);
		this.#jobs.set(k, {
			owner,
			job: { ...job, id },
			intervalMs,
			batchBudgetMs: Math.max(100, job.batchBudgetMs ?? this.config.defaultBatchBudgetMs),
			// El primer lote no sale en el acto: el arranque es el peor momento para sumar trabajo.
			nextRunAt: Date.now() + intervalMs,
			idleRounds: 0,
			running: false,
			lastRunAt: null,
			lastDurationMs: null,
			lastProcessed: null,
			totalProcessed: 0,
			lastError: null,
			consecutiveFailures: 0,
			abort: null,
		});
		this.logger.logInfo(`Trabajo de fondo registrado: ${k} (cada ${Math.round(intervalMs / 1000)}s)`);
	}

	unregister(owner: string, id: string): boolean {
		const k = key(owner, id);
		const entry = this.#jobs.get(k);
		if (!entry) return false;
		entry.abort?.abort();
		this.#jobs.delete(k);
		this.logger.logInfo(`Trabajo de fondo dado de baja: ${k}`);
		return true;
	}

	unregisterOwner(owner: string): number {
		let removed = 0;
		for (const [k, entry] of this.#jobs) {
			if (entry.owner !== owner) continue;
			entry.abort?.abort();
			this.#jobs.delete(k);
			removed++;
		}
		if (removed > 0) this.logger.logInfo(`${removed} trabajo(s) de fondo dados de baja con ${owner}`);
		return removed;
	}

	list(): IdleJobStatus[] {
		return [...this.#jobs.entries()].map(([k, e]) => ({
			key: k,
			owner: e.owner,
			id: e.job.id,
			description: e.job.description ?? null,
			intervalMs: e.intervalMs,
			lastRunAt: e.lastRunAt ? new Date(e.lastRunAt).toISOString() : null,
			lastDurationMs: e.lastDurationMs,
			lastProcessed: e.lastProcessed,
			idleRounds: e.idleRounds,
			totalProcessed: e.totalProcessed,
			lastError: e.lastError,
			running: e.running,
		}));
	}

	async #tick(): Promise<void> {
		if (this.#ticking) return;
		this.#ticking = true;
		try {
			if (this.#jobs.size === 0) return;
			if (!this.#sampler.read().idle) return;

			const entry = this.#pickDue();
			if (entry) await this.#runBatch(entry);
		} finally {
			this.#ticking = false;
		}
	}

	/** Siguiente trabajo vencido, en round-robin para que ninguno acapare los turnos. */
	#pickDue(): JobEntry | null {
		const entries = [...this.#jobs.values()];
		const now = Date.now();
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[(this.#cursor + i) % entries.length];
			if (entry.running || entry.nextRunAt > now) continue;
			this.#cursor = (this.#cursor + i + 1) % entries.length;
			return entry;
		}
		return null;
	}

	async #runBatch(entry: JobEntry): Promise<void> {
		const abort = new AbortController();
		const deadline = Date.now() + entry.batchBudgetMs;
		const timer = setTimeout(() => abort.abort(), entry.batchBudgetMs);
		timer.unref?.();

		entry.running = true;
		entry.abort = abort;
		const startedAt = Date.now();
		try {
			const processed = await entry.job.run({ signal: abort.signal, deadline });
			entry.lastProcessed = processed;
			entry.totalProcessed += Math.max(0, processed);
			entry.lastError = null;
			entry.consecutiveFailures = 0;
			// Con trabajo vuelve al intervalo declarado para drenar el pendiente a ritmo constante.
			entry.idleRounds = processed > 0 ? 0 : entry.idleRounds + 1;
		} catch (e) {
			entry.lastError = (e as Error).message;
			// Un fallo aislado sólo espacia (una base caída se recupera sola); dar de baja es
			// tarea de `#evictIfDead`.
			entry.idleRounds++;
			entry.consecutiveFailures++;
			this.logger.logWarn(`Trabajo de fondo ${key(entry.owner, entry.job.id)} falló: ${entry.lastError}`);
		} finally {
			clearTimeout(timer);
			entry.running = false;
			entry.abort = null;
			entry.lastRunAt = startedAt;
			entry.lastDurationMs = Date.now() - startedAt;
			entry.nextRunAt = Date.now() + this.#backoffFor(entry);
			this.#evictIfDead(entry);
		}
	}

	/**
	 * Da de baja un trabajo que falla siempre. El desregistro normal es el `stop()` de su módulo;
	 * esto cubre al que se fue sin pasar por ahí, con el `run` cerrado sobre managers muertos.
	 */
	#evictIfDead(entry: JobEntry): void {
		if (entry.consecutiveFailures < this.config.maxConsecutiveFailures) return;
		const k = key(entry.owner, entry.job.id);
		this.#jobs.delete(k);
		this.logger.logWarn(
			`Trabajo de fondo ${k} dado de baja tras ${entry.consecutiveFailures} fallos seguidos ` +
				`(último: ${entry.lastError}). Se vuelve a registrar solo si su módulo arranca de nuevo.`
		);
	}

	#backoffFor(entry: JobEntry): number {
		if (entry.idleRounds === 0) return entry.intervalMs;
		const factor = 2 ** Math.min(entry.idleRounds, 10);
		return Math.min(entry.intervalMs * factor, this.config.maxBackoffMs);
	}
}
