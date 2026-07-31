/**
 * Ring buffer de logs en memoria del proceso del kernel.
 *
 * Vive en `@common` (y no en `src/utils/`) porque los presets no pueden importar
 * `src/utils/...` pero sí `@common`: es el único punto donde el consumidor (la
 * tab de Logs del modules-manager) y el productor (ConsoleLogger) se encuentran.
 *
 * Se instancia al importarse, así que ya está capturando cuando arranca el kernel:
 * el boot completo queda en el buffer sin necesidad de un servicio que lo inicie.
 * No se persiste nada: si el proceso muere, los logs se van con él (a propósito).
 */

export type LogLevel = "info" | "ok" | "warn" | "error" | "debug";

export interface LogEntry {
	seq: number;
	ts: string;
	level: LogLevel;
	module: string;
	message: string;
}

export interface LogQuery {
	level?: LogLevel;
	/** Coincidencia exacta o por prefijo (los sub-loggers son `Padre:Hijo`). */
	module?: string;
	/** Substring case-insensitive. Nunca se compila como regex. */
	q?: string;
	limit?: number;
	/** Paginación descendente: devuelve entradas con `seq` menor al cursor. */
	cursor?: number;
}

export interface LogPage {
	logs: LogEntry[];
	nextCursor: number | null;
	modules: string[];
}

const CAPACITY = 5000;
/**
 * Corta mensajes gigantes (dumps, stacks) para que el buffer tenga techo de RAM. Se exporta porque
 * el productor debe recortar ANTES de redactar: redactar es superlineal sobre el largo del texto.
 */
export const MAX_MESSAGE_CHARS = 4000;
/** Techo defensivo: un productor con nombres dinámicos no puede inflar el índice. */
const MAX_TRACKED_MODULES = 500;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function matches(entry: LogEntry, level: LogLevel | undefined, module: string | undefined, needle: string | undefined): boolean {
	if (level && entry.level !== level) return false;
	if (module && entry.module !== module && !entry.module.startsWith(`${module}:`)) return false;
	// `includes` sobre minúsculas en vez de `new RegExp(q)`: el filtro viene de la
	// UI y compilar input del usuario como regex habilita ReDoS.
	if (needle && !entry.message.toLowerCase().includes(needle) && !entry.module.toLowerCase().includes(needle)) return false;
	return true;
}

class LogRingBuffer {
	readonly #entries: (LogEntry | undefined)[] = new Array<LogEntry | undefined>(CAPACITY);
	readonly #modules = new Set<string>();
	/** Próximo slot a escribir; el buffer pisa la entrada más vieja al dar la vuelta. */
	#next = 0;
	#count = 0;
	#seq = 0;

	push(level: LogLevel, module: string, message: string): void {
		const text = message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS)}…` : message;
		this.#entries[this.#next] = { seq: ++this.#seq, ts: new Date().toISOString(), level, module, message: text };
		this.#next = (this.#next + 1) % CAPACITY;
		if (this.#count < CAPACITY) this.#count++;
		if (module && this.#modules.size < MAX_TRACKED_MODULES) this.#modules.add(module);
	}

	query(filter: LogQuery = {}): LogPage {
		const limit = Math.min(Math.max(Math.trunc(filter.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
		const needle = filter.q?.trim().toLowerCase() || undefined;
		const module = filter.module?.trim() || undefined;
		const logs: LogEntry[] = [];
		let nextCursor: number | null = null;

		// Recorrido de más nuevo a más viejo: el orden de `seq` es el del recorrido,
		// así que el cursor se aplica saltando entradas hasta pasarlo.
		for (let i = 1; i <= this.#count; i++) {
			const entry = this.#entries[(this.#next - i + CAPACITY) % CAPACITY];
			if (!entry) continue;
			if (filter.cursor !== undefined && entry.seq >= filter.cursor) continue;
			if (!matches(entry, filter.level, module, needle)) continue;
			if (logs.length === limit) {
				// Hay al menos una coincidencia más: recién ahí el cursor tiene sentido.
				nextCursor = logs.at(-1)!.seq;
				break;
			}
			logs.push(entry);
		}

		return { logs, nextCursor, modules: this.modules() };
	}

	modules(): string[] {
		return [...this.#modules].sort((a, b) => a.localeCompare(b));
	}

	size(): number {
		return this.#count;
	}
}

export const logBuffer = new LogRingBuffer();
