import * as fs from "node:fs";

/**
 * Señales de memoria del host para frenar la carga en paralelo.
 *
 * Deliberadamente **no** usa `os.freemem()`: en Linux devuelve `MemFree`, que excluye
 * la caché reclamable, así que reporta escasez falsa en cualquier máquina que haya
 * hecho I/O. La fuente correcta es `MemAvailable` de `/proc/meminfo`, o los contadores
 * del cgroup cuando el proceso corre acotado.
 *
 * Ojo con la trampa documentada: `memory.current` del cgroup **no es «lo nuestro»** —
 * en una máquina de desarrollo incluye todo lo demás de la sesión (un VSCode puede
 * aportar varios GB). Por eso el freno es por *disponible*, nunca por *usado*.
 */
export class MemoryProbe {
	/** Se resuelve una vez: montar/desmontar cgroups a mitad del boot no es un caso real. */
	readonly #cgroupPaths = {
		max: "/sys/fs/cgroup/memory.max",
		current: "/sys/fs/cgroup/memory.current",
		events: "/sys/fs/cgroup/memory.events",
	};
	#lastHighEvents: number | null = null;

	/** Bytes que se pueden pedir sin empezar a molestar a nadie, o `null` si no hay señal. */
	availableBytes(): number | null {
		const cgroup = this.#cgroupAvailable();
		if (cgroup !== null) return cgroup;
		return this.#memAvailable();
	}

	/**
	 * Presión de memoria de los últimos 10 s (`/proc/pressure/memory`, línea `some`),
	 * en porcentaje de tiempo estancado. `null` si el kernel no expone PSI.
	 */
	pressureAvg10(): number | null {
		const raw = this.#read("/proc/pressure/memory");
		if (!raw) return null;
		const some = raw.split("\n").find((line) => line.startsWith("some"));
		const match = some ? /avg10=([\d.]+)/.exec(some) : null;
		return match ? Number(match[1]) : null;
	}

	/**
	 * `true` si el cgroup registró nuevos eventos `high` desde la consulta anterior:
	 * el kernel ya nos está throttleando, sin importar qué diga el resto de las señales.
	 */
	throttledSinceLastCheck(): boolean {
		const raw = this.#read(this.#cgroupPaths.events);
		if (!raw) return false;
		const match = /^high (\d+)$/m.exec(raw);
		if (!match) return false;
		const high = Number(match[1]);
		const previous = this.#lastHighEvents;
		this.#lastHighEvents = high;
		return previous !== null && high > previous;
	}

	#cgroupAvailable(): number | null {
		const max = this.#readNumber(this.#cgroupPaths.max);
		const current = this.#readNumber(this.#cgroupPaths.current);
		// `max` es "max" (sin límite) en la mayoría de los hosts: ahí el cgroup no dice nada.
		if (max === null || current === null || !Number.isFinite(max)) return null;
		return Math.max(0, max - current);
	}

	#memAvailable(): number | null {
		const raw = this.#read("/proc/meminfo");
		if (!raw) return null;
		const match = /^MemAvailable:\s+(\d+) kB$/m.exec(raw);
		return match ? Number(match[1]) * 1024 : null;
	}

	#readNumber(file: string): number | null {
		const raw = this.#read(file)?.trim();
		if (!raw) return null;
		if (raw === "max") return Number.POSITIVE_INFINITY;
		const value = Number(raw);
		return Number.isFinite(value) ? value : null;
	}

	#read(file: string): string | null {
		try {
			return fs.readFileSync(file, "utf8");
		} catch {
			return null;
		}
	}
}
