/**
 * Acumulador en memoria de las métricas por endpoint y su volcado a Redis.
 *
 * El tramo vivo es **la hora en curso**: el hot path sólo suma en memoria, un flush periódico
 * vuelca el delta al hash `epm:<YYYY-MM-DDTHH>` y, al cerrarse la hora, ese hash se archiva en
 * Mongo (ver `metrics-store.ts`) y se borra. Redis queda como red de contención del tramo en
 * curso: sobrevive a un hot-reload o a un reinicio dentro de la misma hora.
 */
import type RedisProvider from "../../../../providers/queue/redis/index.ts";
import { addSample, emptyAggregate, HIST_SLOTS, mergeAggregate, type MetricAggregate } from "./metrics-aggregate.js";

type ResolvedMetrics = { enabled: boolean; flushIntervalMs: number; retentionHours: number };
/** Config cruda (proviene de `config.json` → `private.metrics`, valores string interpolados). */
export type MetricsConfig = { [K in keyof ResolvedMetrics]?: ResolvedMetrics[K] | string };

interface Bucket {
	agg: MetricAggregate;
	/** Totales ya volcados a Redis: lo pendiente es el delta contra los acumulados (hace el flush idempotente). */
	flushed: MetricAggregate;
}

const HASH_PREFIX = "epm:";
const HOUR_MS = 3_600_000;
/** Techo de horas cerradas en espera de volcado: acota la memoria cuando no hay Redis (nunca se drenan). */
const MAX_PENDING_HOURS = 3;

// Singleton de módulo, NO estado capturado en la closure del wrapper: `registerRoute()` no dedupe,
// y tras un hot-reload el wrapper viejo sigue atendiendo; así ambos escriben en el mismo acumulador.
const buckets = new Map<string, Bucket>();
/** Horas ya cerradas con delta sin volcar: el rollover corre en el hot path y no puede hacer I/O. */
const pending: Array<{ hour: string; rows: Map<string, Bucket> }> = [];
/**
 * Dueño declarado de cada clave. Vive aparte de los buckets porque sobrevive al cierre de hora:
 * el hash de Redis guarda contadores, no el servicio dueño, y al archivar hay que poder nombrarlo.
 */
const owners = new Map<string, string>();
let config: ResolvedMetrics = { enabled: true, flushIntervalMs: 60_000, retentionHours: 25 };

function parseBoolean(value: boolean | string | undefined, fallback: boolean): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string" || value.trim() === "") return fallback;
	return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: number | string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Resuelve y aplica la config declarada en `config.json` (sin `process.env`). */
export function configureMetrics(raw: MetricsConfig = {}): ResolvedMetrics {
	config = {
		enabled: parseBoolean(raw.enabled, true),
		flushIntervalMs: parsePositiveInteger(raw.flushIntervalMs, 60_000),
		// El mínimo son 25: 24 horas cerradas de ventana más la que se está midiendo.
		retentionHours: Math.max(25, parsePositiveInteger(raw.retentionHours, 25)),
	};
	return config;
}

/**
 * Instante en que ESTE proceso empezó a medir. Una hora cerrada sin hash en Redis puede ser una
 * hora tranquila (kernel arriba, cero requests) o una hora sin medir (kernel caído): la única
 * forma de distinguirlas es si el proceso ya estaba corriendo cuando esa hora empezó.
 */
const measuringSinceMs = Date.now();
export const measuringSince = (): number => measuringSinceMs;

/** Permite al hot path saltearse el costo de medir el cuerpo cuando las métricas están apagadas. */
export const isRecording = (): boolean => config.enabled;
export const retentionHours = (): number => config.retentionHours;

/** Comienzo (ms) de la hora UTC que contiene `at`. Las horas UTC caen en múltiplos exactos de `HOUR_MS`. */
export const hourStartMs = (at: number = Date.now()): number => Math.floor(at / HOUR_MS) * HOUR_MS;
/** Etiqueta `YYYY-MM-DDTHH` de una hora: la que nombra su hash en Redis. */
const hourLabel = (startMs: number): string => new Date(startMs).toISOString().slice(0, 13);
const hashOf = (hour: string): string => `${HASH_PREFIX}${hour}`;

let currentHour = hourLabel(hourStartMs());
let nextRolloverMs = hourStartMs() + HOUR_MS;

/**
 * Cierra la hora si ya se cruzó su límite. Se chequea también en `record()` porque `flush()`
 * sólo corre si hay Redis: sin él, el acumulador seguiría sumando horas distintas bajo la
 * etiqueta de la actual. Es una comparación numérica, apta para el hot path.
 */
function maybeRollover(now: number = Date.now()): void {
	if (now < nextRolloverMs) return;
	// El umbral primero: aunque algo fallara abajo, el rollover no se reintenta en cada request.
	nextRolloverMs = hourStartMs(now) + HOUR_MS;
	const closed = currentHour;
	currentHour = hourLabel(hourStartMs(now));
	if (buckets.size === 0) return;
	// Se conservan las MISMAS instancias de Bucket: si hay un flush en vuelo, su `flushed` sigue
	// siendo el corte correcto y el próximo volcado no duplica el delta.
	const rows = new Map([...buckets].filter(([, b]) => b.agg.count > b.flushed.count));
	buckets.clear();
	if (rows.size === 0) return;
	pending.push({ hour: closed, rows });
	while (pending.length > MAX_PENDING_HOURS) pending.shift();
}

/** `bytes === null` = la respuesta no reportó tamaño (204/304, stream, hijack): no es 0 bytes. */
export function record(key: string, owner: string, ms: number, bytes: number | null, status: number): void {
	if (!config.enabled) return;
	maybeRollover();
	let bucket = buckets.get(key);
	if (!bucket) {
		bucket = { agg: emptyAggregate(), flushed: emptyAggregate() };
		buckets.set(key, bucket);
	}
	if (owner) owners.set(key, owner);
	addSample(bucket.agg, ms, bytes, status);
}

export const ownerOf = (key: string): string => owners.get(key) ?? "";

/** Etiqueta de la hora que se está midiendo ahora (tras aplicar el rollover pendiente). */
export function currentHourLabel(): string {
	maybeRollover();
	return currentHour;
}

/**
 * Delta que el hot path acumuló y todavía no llegó a Redis, por clave. Sumárselo al hash de la
 * hora en curso es lo que hace que el panel vea un pico de errores en el acto y no con el
 * retardo del ticker de flush.
 */
export function unflushedDelta(): Map<string, MetricAggregate> {
	maybeRollover();
	const out = new Map<string, MetricAggregate>();
	for (const [key, b] of buckets) {
		if (b.agg.count <= b.flushed.count) continue;
		const delta = emptyAggregate();
		mergeAggregate(delta, b.agg);
		// Resta del corte ya volcado. `maxMs` no es aditivo: se deja el pico del bucket entero
		// (a lo sumo repite un pico que Redis ya conoce, y el máximo de la ventana no cambia).
		delta.count -= b.flushed.count;
		delta.sumMs -= b.flushed.sumMs;
		delta.sumBytes -= b.flushed.sumBytes;
		delta.bytesCount -= b.flushed.bytesCount;
		delta.errCount -= b.flushed.errCount;
		for (let i = 0; i < delta.hist.length; i++) delta.hist[i] -= b.flushed.hist[i] ?? 0;
		for (const [status, n] of Object.entries(b.flushed.errByStatus)) {
			const left = (delta.errByStatus[status] ?? 0) - n;
			if (left > 0) delta.errByStatus[status] = left;
			else delete delta.errByStatus[status];
		}
		out.set(key, delta);
	}
	return out;
}

/** Limpia el acumulado en memoria de una clave (o de todas). Devuelve las claves que borró. */
export function reset(key?: string): string[] {
	// Rotar antes de borrar: si se cruzó el límite de hora, lo que hay en `buckets` todavía es de
	// la hora anterior y pertenece a su hash; resetear "ahora" no puede llevárselo puesto.
	maybeRollover();
	if (key) {
		owners.delete(key);
		return buckets.delete(key) ? [key] : [];
	}
	const cleared = [...buckets.keys()];
	buckets.clear();
	owners.clear();
	return cleared;
}

/**
 * Lock de reentrada del flush. `flushed` se actualiza recién DESPUÉS de los `hincrby` de ese
 * bucket, así que dos flushes solapados (Redis lento y el ticker que vuelve a disparar)
 * calcularían el mismo delta dos veces y lo sumarían dos veces al hash de la hora.
 */
let flushing = false;

/** Delta del bucket contra su último corte volcado, campo por campo. `flushed` se actualiza al final. */
async function flushBucket(redis: RedisProvider, hash: string, key: string, b: Bucket): Promise<void> {
	const { agg, flushed } = b;
	await redis.hincrby(hash, `${key}|count`, agg.count - flushed.count);
	await redis.hincrby(hash, `${key}|ms`, Math.round(agg.sumMs - flushed.sumMs));
	if (agg.bytesCount > flushed.bytesCount) {
		await redis.hincrby(hash, `${key}|bytes`, Math.round(agg.sumBytes - flushed.sumBytes));
		await redis.hincrby(hash, `${key}|bcount`, agg.bytesCount - flushed.bytesCount);
	}
	if (agg.errCount > flushed.errCount) await redis.hincrby(hash, `${key}|err`, agg.errCount - flushed.errCount);
	// El pico no es aditivo: se guarda como valor absoluto y sólo cuando sube.
	if (agg.maxMs > flushed.maxMs) await redis.hset(hash, `${key}|max`, String(Math.round(agg.maxMs * 100) / 100));
	// Histograma y desglose por código: sólo las clases con delta (una ruta suele tocar 1-3 de las 14).
	for (let i = 0; i < agg.hist.length; i++) {
		const delta = agg.hist[i] - (flushed.hist[i] ?? 0);
		if (delta > 0) await redis.hincrby(hash, `${key}|h${i}`, delta);
	}
	for (const [status, n] of Object.entries(agg.errByStatus)) {
		const delta = n - (flushed.errByStatus[status] ?? 0);
		if (delta > 0) await redis.hincrby(hash, `${key}|s${status}`, delta);
	}
	const snapshot = emptyAggregate();
	mergeAggregate(snapshot, agg);
	b.flushed = snapshot;
}

/** Vuelca al hash de `hour` el delta desde el último flush (por bucket, idempotente). */
async function flushRows(redis: RedisProvider, hour: string, rows: Map<string, Bucket>): Promise<void> {
	const hash = hashOf(hour);
	let wrote = false;
	// Copia de las entradas, NO el Map vivo: si un rollover limpia `buckets` durante un `await`, el
	// iterador nativo sigue vivo y entregaría los buckets de la hora NUEVA para volcarlos en `hash`.
	for (const [key, b] of [...rows]) {
		if (b.agg.count <= b.flushed.count) continue;
		await flushBucket(redis, hash, key, b);
		wrote = true;
	}
	// El TTL se re-arma en cada volcado: cuesta una llamada y evita rastrear si el hash es nuevo.
	// Sobrevive de sobra a la ventana: es la red por si el archivado a Mongo se atrasa.
	if (wrote) await redis.expire(hash, config.retentionHours * 3600);
}

/** Vuelca a Redis el delta desde el último flush. Tolerante a fallo: lo no volcado se reintenta solo. */
export async function flush(redis: RedisProvider): Promise<void> {
	if (!config.enabled || flushing) return;
	maybeRollover();
	if (pending.length === 0 && buckets.size === 0) return;
	flushing = true;
	try {
		// Las horas cerradas van cada una a SU hash; si no, su delta caería en la hora equivocada.
		while (pending.length > 0) {
			const entry = pending[0];
			await flushRows(redis, entry.hour, entry.rows);
			// Sacar SÓLO la entrada que se volcó: durante el `await` puede haber corrido un rollover
			// que, por el tope de horas, ya descartó ésta; un `shift()` a ciegas se llevaría puesta
			// (sin volcar) a la hora que ocupó su lugar.
			if (pending[0] === entry) pending.shift();
		}
		await flushRows(redis, currentHour, buckets);
	} catch {
		// Best-effort: el delta no volcado queda vivo en memoria y se reintenta en el próximo tick.
	} finally {
		flushing = false;
	}
}

/**
 * Aplica al agregado el valor de un campo del hash, identificado por el sufijo que sigue al `|`.
 * `h<i>` es una clase del histograma y `s<code>` un contador por código HTTP; el resto son totales.
 */
function applyField(agg: MetricAggregate, suffix: string, n: number): void {
	if (suffix === "count") agg.count = n;
	else if (suffix === "ms") agg.sumMs = n;
	else if (suffix === "max") agg.maxMs = n;
	else if (suffix === "bytes") agg.sumBytes = n;
	else if (suffix === "bcount") agg.bytesCount = n;
	else if (suffix === "err") agg.errCount = n;
	else if (suffix.startsWith("h")) {
		const slot = Number(suffix.slice(1));
		if (Number.isInteger(slot) && slot >= 0 && slot < HIST_SLOTS) agg.hist[slot] = n;
	} else if (suffix.startsWith("s")) {
		const status = Number(suffix.slice(1));
		if (Number.isInteger(status)) agg.errByStatus[String(status)] = n;
	}
}

/** Lee el hash de una hora y lo devuelve como agregados por clave. Vacío si no existe o falla. */
export async function readHour(redis: RedisProvider, hour: string): Promise<Map<string, MetricAggregate>> {
	const raw = await redis.hgetall(hashOf(hour)).catch(() => ({}) as Record<string, string>);
	const rows = new Map<string, MetricAggregate>();
	for (const [field, value] of Object.entries(raw ?? {})) {
		const sep = field.lastIndexOf("|");
		if (sep <= 0) continue;
		const key = field.slice(0, sep);
		let agg = rows.get(key);
		if (!agg) {
			agg = emptyAggregate();
			rows.set(key, agg);
		}
		applyField(agg, field.slice(sep + 1), Number(value) || 0);
	}
	for (const [key, agg] of rows) if (agg.count <= 0) rows.delete(key);
	return rows;
}

/** Borra el hash de una hora (tras archivarla, o al resetear). */
export async function dropHour(redis: RedisProvider, hour: string): Promise<void> {
	await redis.del(hashOf(hour));
}

/** Borra los campos de UNA clave del hash de una hora, dejando el resto intacto. */
export async function dropKeyFromHour(redis: RedisProvider, hour: string, key: string): Promise<void> {
	const hash = hashOf(hour);
	const raw = await redis.hgetall(hash).catch(() => ({}) as Record<string, string>);
	const fields = Object.keys(raw ?? {}).filter((f) => f.slice(0, f.lastIndexOf("|")) === key);
	for (const field of fields) await redis.hdel(hash, field);
}

/**
 * Etiquetas de las horas cerradas que todavía podrían tener un hash sin archivar, de la más
 * vieja a la más nueva. Se enumeran a partir del reloj en vez de barrer Redis con `KEYS`/`SCAN`:
 * el conjunto es acotado y conocido (la retención), y así el barrido no crece con la base.
 */
export function closedHoursToArchive(now: number = Date.now()): string[] {
	const current = hourStartMs(now);
	const out: string[] = [];
	for (let i = config.retentionHours; i >= 1; i--) out.push(hourLabel(current - i * HOUR_MS));
	return out;
}

/** Horas cerradas de la ventana de 24 h, de la más vieja a la más nueva. */
export function windowHours(now: number = Date.now()): string[] {
	const current = hourStartMs(now);
	const out: string[] = [];
	for (let i = 24; i >= 1; i--) out.push(hourLabel(current - i * HOUR_MS));
	return out;
}
