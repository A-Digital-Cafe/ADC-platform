/**
 * Cuánta presión tiene ESTE proceso, en una sola cifra de 0 a 100.
 *
 * Mide **retraso del event loop** y no CPU: el CPU de un host que además corre Mongo, Garage y un
 * par de bundlers está alto casi siempre y no dice si las requests están esperando. Como el
 * JavaScript es de un solo hilo, un temporizador programado a 250 ms que llega a los 400 significa
 * 150 ms de trabajo encolado por delante de la próxima request. Se mide por deriva de temporizador
 * y no con `monitorEventLoopDelay`: son diez líneas y la precisión que hace falta es de decenas de ms.
 *
 * No mide nada fuera de este proceso: una consulta lenta a Mongo deja el event loop libre, así que
 * un nodo saturado de escrituras puede reportar presión baja. Es correcto — si el cuello es la base
 * compartida, mover la request a otro nodo no la acelera (ver `OffloadPolicy`).
 */

/** Cada cuánto se toma una muestra. */
const SAMPLE_MS = 250;
/** Retraso a partir del cual se considera presión máxima. */
const SATURATION_LAG_MS = 250;
/** Peso de la muestra nueva en la media móvil: alto reacciona rápido, bajo no oscila. */
const ALPHA = 0.3;

let lagMs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let expected = 0;

/**
 * Arranca el muestreo. Idempotente y sin efecto sobre el ciclo de vida del proceso: el temporizador
 * va `unref`, así que un proceso que sólo tuviera esto pendiente termina igual.
 */
export function startLoadSampler(): void {
	if (timer) return;
	expected = Date.now() + SAMPLE_MS;
	timer = setInterval(() => {
		const now = Date.now();
		const drift = Math.max(0, now - expected);
		lagMs = ALPHA * drift + (1 - ALPHA) * lagMs;
		expected = now + SAMPLE_MS;
	}, SAMPLE_MS);
	timer.unref?.();
}

export function stopLoadSampler(): void {
	if (timer) clearInterval(timer);
	timer = null;
	lagMs = 0;
}

export function eventLoopLagMs(): number {
	return Math.round(lagMs);
}

/**
 * Presión de 0 a 100. `0` = el proceso va al día; `100` = está tan atrás que una request más se
 * encola detrás de un cuarto de segundo de trabajo.
 */
export function pressure(): number {
	return Math.min(100, Math.round((lagMs / SATURATION_LAG_MS) * 100));
}
