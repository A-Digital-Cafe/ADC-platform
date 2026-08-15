/**
 * Reparto del ancho de banda de subida entre las transferencias en curso de ESTE proceso.
 *
 * Sin reparto, la primera subida grande se lleva todo el caño hasta terminar: la plataforma se ve
 * lenta sin que nada esté caído y sin que ningún límite se haya superado (los topes por usuario
 * miden *cuánto* sube cada uno, no *a qué velocidad*). La política es **partes iguales entre las
 * subidas activas**, así nadie paga por un límite que no hace falta.
 *
 * El caudal configurado es el techo con la máquina tranquila: entre `CPU_OPEN` y `CPU_CLOSE` baja
 * linealmente hasta `MIN_RATIO`, porque mover bytes rápido con el proceso ahogado sólo suma trabajo
 * a una cola atrasada. `MIN_RATIO` nunca es cero: una subida colgada no libera socket, memoria ni el
 * lugar que ocupa en el tope de concurrencia, así que terminarlas despacio es lo que devuelve
 * recursos. El CPU es el de este proceso, medido igual que `LoadSampler` (100 % = un núcleo).
 *
 * No alcanza al tráfico que no pasa por acá: una subida presignada directa al almacén de objetos no
 * ve este gobernador. Tampoco toca las bajadas.
 */

/** CPU del proceso hasta el cual el caudal está entero. */
const CPU_OPEN_PERCENT = 30;
/** CPU del proceso a partir del cual el caudal queda en su mínimo. */
const CPU_CLOSE_PERCENT = 80;
/** Fracción del caudal que sobrevive con el proceso ahogado. Nunca 0. */
const MIN_RATIO = 0.2;
/** Cada cuánto se remuestrea el CPU. Más fino no aporta: el caudal se recalcula por chunk. */
const CPU_SAMPLE_MS = 1000;

/** Bytes por segundo para todas las subidas juntas. `0` = sin límite. */
let totalBytesPerSec = 0;
/** Transferencias que hoy se reparten el caudal. */
let active = 0;

let cpuPercent = 0;
let lastCpu: NodeJS.CpuUsage | null = null;
let lastAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function sampleCpu(): void {
	const now = Date.now();
	const cpu = process.cpuUsage();
	if (lastCpu) {
		const elapsedMs = Math.max(1, now - lastAt);
		const usedMs = (cpu.user - lastCpu.user + (cpu.system - lastCpu.system)) / 1000;
		cpuPercent = Math.max(0, (usedMs / elapsedMs) * 100);
	}
	lastCpu = cpu;
	lastAt = now;
}

/**
 * El muestreo sólo corre cuando hay un caudal configurado: sin límite, el número no lo mira nadie.
 * El temporizador va `unref` para no sostener el proceso vivo.
 */
function startSampling(): void {
	if (timer) return;
	lastCpu = process.cpuUsage();
	lastAt = Date.now();
	timer = setInterval(sampleCpu, CPU_SAMPLE_MS);
	timer.unref?.();
}

function stopSampling(): void {
	if (timer) clearInterval(timer);
	timer = null;
	lastCpu = null;
	cpuPercent = 0;
}

/**
 * Define el caudal total; `0` (o un valor inválido) desactiva el gobernador. En caliente porque lo
 * cambia el panel: las transferencias en curso recalculan en el chunk siguiente, sin cortarse.
 */
export function configureBandwidth(bytesPerSec: number): void {
	totalBytesPerSec = Number.isFinite(bytesPerSec) && bytesPerSec > 0 ? Math.floor(bytesPerSec) : 0;
	if (totalBytesPerSec > 0) startSampling();
	else stopSampling();
}

export function bandwidthBudget(): number {
	return totalBytesPerSec;
}

/** Multiplicador por carga, entre `MIN_RATIO` y 1. */
function loadFactor(): number {
	if (cpuPercent <= CPU_OPEN_PERCENT) return 1;
	if (cpuPercent >= CPU_CLOSE_PERCENT) return MIN_RATIO;
	const span = CPU_CLOSE_PERCENT - CPU_OPEN_PERCENT;
	return 1 - ((cpuPercent - CPU_OPEN_PERCENT) / span) * (1 - MIN_RATIO);
}

/**
 * Lo que le toca AHORA a una transferencia. `Infinity` = sin límite (no hay caudal configurado).
 *
 * Se consulta por chunk y no se cachea: es lo que hace que una subida que entra le baje la velocidad
 * a las que ya estaban, y que la última en quedar recupere el caño entero.
 */
export function perUploadBytesPerSec(): number {
	if (totalBytesPerSec <= 0) return Number.POSITIVE_INFINITY;
	return Math.max(1, Math.floor((totalBytesPerSec * loadFactor()) / Math.max(1, active)));
}

/** Una transferencia entra al reparto. `release()` es idempotente: se lo llama desde varios caminos. */
export interface UploadSlot {
	release(): void;
}

export function acquireUploadSlot(): UploadSlot {
	active++;
	let released = false;
	return {
		release() {
			// Un stream que se cierra por dos caminos (fin normal + destrucción) dejaría el contador
			// en negativo y el reparto daría más caudal del que hay.
			if (released) return;
			released = true;
			active = Math.max(0, active - 1);
		},
	};
}

/** Lo que muestra el panel. `cpuPercent` es 0 cuando no hay caudal configurado (no se muestrea). */
export function bandwidthStatus(): {
	bytesPerSec: number;
	activeUploads: number;
	cpuPercent: number;
	effectiveBytesPerSec: number;
	perUploadBytesPerSec: number;
} {
	const effective = totalBytesPerSec > 0 ? Math.floor(totalBytesPerSec * loadFactor()) : 0;
	const perUpload = perUploadBytesPerSec();
	return {
		bytesPerSec: totalBytesPerSec,
		activeUploads: active,
		cpuPercent: Math.round(cpuPercent),
		effectiveBytesPerSec: effective,
		perUploadBytesPerSec: Number.isFinite(perUpload) ? perUpload : 0,
	};
}
