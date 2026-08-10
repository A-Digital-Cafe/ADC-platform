import os from "node:os";

/**
 * ¿Está el proceso lo bastante ocioso como para meterle trabajo de fondo?
 *
 * Manda el **CPU de este proceso** (los módulos corren in-process: un barrido compite por el
 * mismo event loop que las requests), medido igual que el panel de recursos para que los dos
 * números sean comparables. El `loadavg` del host es un segundo freno —el proceso puede estar
 * tranquilo y la máquina ahogada por Mongo o el MTA—; en Windows devuelve ceros y no aplica.
 */
export interface LoadReading {
	/** 100 % = un núcleo saturado. */
	cpuPercent: number;
	/** Carga del host normalizada por núcleo (1 = todos los núcleos ocupados). */
	loadPerCore: number;
	idle: boolean;
}

export interface LoadThresholds {
	/** Techo de CPU del proceso para considerarlo ocioso. */
	maxCpuPercent: number;
	/** Techo de carga por núcleo del host. `0` desactiva el freno. */
	maxLoadPerCore: number;
}

const CPU_COUNT = Math.max(1, os.cpus().length);

export class LoadSampler {
	#lastCpu: NodeJS.CpuUsage = process.cpuUsage();
	#lastAt = Date.now();

	constructor(private readonly thresholds: LoadThresholds) {}

	/**
	 * Muestrea contra la lectura anterior (la primera, contra la construcción del sampler): un
	 * acumulado desde el boot se aplana a las horas y diría "ocioso" justo cuando no lo está.
	 */
	read(): LoadReading {
		const now = Date.now();
		const cpu = process.cpuUsage();
		const elapsedMs = Math.max(1, now - this.#lastAt);
		const usedMs = (cpu.user - this.#lastCpu.user + (cpu.system - this.#lastCpu.system)) / 1000;
		this.#lastCpu = cpu;
		this.#lastAt = now;

		const cpuPercent = Math.max(0, (usedMs / elapsedMs) * 100);
		const loadPerCore = os.loadavg()[0] / CPU_COUNT;
		const loadOk = this.thresholds.maxLoadPerCore <= 0 || loadPerCore <= this.thresholds.maxLoadPerCore;
		return { cpuPercent, loadPerCore, idle: cpuPercent <= this.thresholds.maxCpuPercent && loadOk };
	}
}
