/**
 * Forma común de los contadores por endpoint y la aritmética que los combina.
 *
 * Los mismos números viajan por tres soportes —memoria (hot path), hash de Redis (hora en
 * curso) y documentos de Mongo (horas archivadas)—; tenerlos en un único tipo aditivo es lo
 * que permite sumar una ventana de 24 h sin que cada capa reimplemente el promedio.
 */

import type { EndpointMetricRow } from "@common/types/endpoints/IEndpointMetrics.ts";

/**
 * Cortes (ms) del histograma de latencia. Escala logarítmica: interesa el orden de magnitud
 * de la cola, no el milisegundo exacto. La clase extra del final es "≥ 10 s" (sin techo).
 */
const LATENCY_BOUNDS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000];
export const HIST_SLOTS = LATENCY_BOUNDS.length + 1;

/** Contadores crudos de un endpoint en un tramo de tiempo. Cada campo es aditivo salvo `maxMs`. */
export interface MetricAggregate {
	count: number;
	sumMs: number;
	maxMs: number;
	sumBytes: number;
	/** Requests que reportaron tamaño: divisor real de `avgBytes` (204/304/streams no reportan). */
	bytesCount: number;
	errCount: number;
	/** Muestras de latencia por clase de `LATENCY_BOUNDS`. */
	hist: number[];
	/** Errores por código HTTP (sólo >= 400: acota la cardinalidad del almacenamiento). */
	errByStatus: Record<string, number>;
}

export const emptyAggregate = (): MetricAggregate => ({
	count: 0,
	sumMs: 0,
	maxMs: 0,
	sumBytes: 0,
	bytesCount: 0,
	errCount: 0,
	hist: new Array<number>(HIST_SLOTS).fill(0),
	errByStatus: {},
});

/** Clase del histograma a la que pertenece una latencia (la última absorbe el resto de lo que se pasa). */
function slotOf(ms: number): number {
	for (let i = 0; i < LATENCY_BOUNDS.length; i++) if (ms < LATENCY_BOUNDS[i]) return i;
	return LATENCY_BOUNDS.length;
}

/** `bytes === null` = la respuesta no reportó tamaño (204/304, stream, hijack): no es 0 bytes. */
export function addSample(agg: MetricAggregate, ms: number, bytes: number | null, status: number): void {
	agg.count++;
	agg.sumMs += ms;
	agg.hist[slotOf(ms)]++;
	if (ms > agg.maxMs) agg.maxMs = ms;
	if (bytes !== null) {
		agg.sumBytes += bytes;
		agg.bytesCount++;
	}
	if (status >= 400) {
		agg.errCount++;
		agg.errByStatus[status] = (agg.errByStatus[status] ?? 0) + 1;
	}
}

/** Suma `source` dentro de `target` (in-place). Es la operación que arma la ventana de 24 h. */
export function mergeAggregate(target: MetricAggregate, source: MetricAggregate): void {
	target.count += source.count;
	target.sumMs += source.sumMs;
	target.sumBytes += source.sumBytes;
	target.bytesCount += source.bytesCount;
	target.errCount += source.errCount;
	if (source.maxMs > target.maxMs) target.maxMs = source.maxMs;
	for (let i = 0; i < target.hist.length; i++) target.hist[i] += source.hist[i] ?? 0;
	for (const [status, n] of Object.entries(source.errByStatus)) target.errByStatus[status] = (target.errByStatus[status] ?? 0) + n;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Percentil estimado desde el histograma: se ubica la clase donde cae el corte y se interpola
 * linealmente dentro de ella. El error queda acotado por el ancho de la clase (~2.5x), que
 * alcanza para responder "¿la cola está mal?" sin persistir cada muestra.
 */
function percentile(hist: number[], samples: number, q: number): number {
	if (samples <= 0) return 0;
	const target = samples * q;
	let acc = 0;
	for (let i = 0; i < hist.length; i++) {
		const n = hist[i] ?? 0;
		if (n === 0) continue;
		if (acc + n < target) {
			acc += n;
			continue;
		}
		const lo = i === 0 ? 0 : LATENCY_BOUNDS[i - 1];
		// Última clase: no tiene techo, así que se reporta su piso ("≥ 10 s") en vez de inventar uno.
		const hi = i >= LATENCY_BOUNDS.length ? lo : LATENCY_BOUNDS[i];
		return round2(lo + ((hi - lo) * (target - acc)) / n);
	}
	return 0;
}

/** Datos que no salen del agregado: identidad del endpoint y su reparto por hora. */
export interface RowContext {
	key: string;
	owner: string;
	/** Llamadas por hora cerrada, alineado con el eje de horas de la página. */
	hourly: number[];
	/** Llamadas del tramo de la hora en curso (excluidas de `perHour`). */
	currentCount: number;
}

/** Arma la fila pública desde el agregado de la ventana completa. */
export function toRow(agg: MetricAggregate, ctx: RowContext): EndpointMetricRow {
	const [method = "", url = ""] = ctx.key.split(" ");
	const d = agg.count || 1;
	// Sólo promedia las respuestas que sí reportaron tamaño; `null` = nunca hubo una.
	const avgBytes = agg.bytesCount > 0 ? Math.round(agg.sumBytes / agg.bytesCount) : null;
	const samples = agg.hist.reduce((acc, n) => acc + n, 0);
	// Techo en el pico observado: la interpolación reparte uniforme dentro de la clase y, con todas
	// las muestras en una sola, devolvería un p90 mayor que el máximo real (que se ve al lado).
	const maxMs = round2(agg.maxMs);
	const p90Ms = samples > 0 ? Math.min(percentile(agg.hist, samples, 0.9), maxMs || Number.POSITIVE_INFINITY) : null;
	// `hourly` puede estar vacío (ninguna hora cerrada medida todavía): ahí no hay media que dar.
	const perHour = ctx.hourly.length > 0 ? round2(ctx.hourly.reduce((acc, n) => acc + n, 0) / ctx.hourly.length) : null;
	return {
		key: ctx.key,
		method,
		url,
		owner: ctx.owner,
		count: agg.count,
		perHour,
		currentCount: ctx.currentCount,
		hourly: ctx.hourly,
		avgMs: round2(agg.sumMs / d),
		p90Ms,
		maxMs,
		avgBytes,
		errCount: agg.errCount,
		errRate: round2(agg.errCount / d),
		errByStatus: agg.errByStatus,
	};
}
