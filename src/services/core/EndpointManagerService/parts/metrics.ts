import type RedisProvider from "../../../../providers/queue/redis/index.ts";
import type { EndpointMetricRow } from "@common/types/endpoints/IEndpointMetrics.ts";

type ResolvedMetrics = { enabled: boolean; flushIntervalMs: number; retentionDays: number };
/** Config cruda (proviene de `config.json` → `private.metrics`, valores string interpolados). */
export type MetricsConfig = { [K in keyof ResolvedMetrics]?: ResolvedMetrics[K] | string };

interface Bucket {
	method: string;
	url: string;
	owner: string;
	count: number;
	sumMs: number;
	sumBytes: number;
	/** Requests que reportaron tamaño: divisor real de `avgBytes` (204/304/streams no reportan). */
	bytesCount: number;
	maxMs: number;
	errCount: number;
	/** Totales ya volcados a Redis: lo pendiente es el delta contra los acumulados (hace el flush idempotente). */
	f: { count: number; ms: number; bytes: number; bcount: number; err: number };
}

const HASH_PREFIX = "epm:";
const DAY_MS = 86_400_000;
/** Techo de días cerrados en espera de volcado: acota la memoria cuando no hay Redis (nunca se drenan). */
const MAX_PENDING_DAYS = 2;

// Singleton de módulo, NO estado capturado en la closure del wrapper: `registerRoute()` no dedupe,
// y tras un hot-reload el wrapper viejo sigue atendiendo; así ambos escriben en el mismo acumulador.
const buckets = new Map<string, Bucket>();
/** Días ya cerrados con delta sin volcar: el rollover corre en el hot path y no puede hacer I/O. */
const pending: Array<{ day: string; rows: Map<string, Bucket> }> = [];
let config: ResolvedMetrics = { enabled: true, flushIntervalMs: 60_000, retentionDays: 7 };

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
		retentionDays: parsePositiveInteger(raw.retentionDays, 7),
	};
	return config;
}

/** Permite al hot path saltearse el costo de medir el cuerpo cuando las métricas están apagadas. */
export const isRecording = (): boolean => config.enabled;
/** Día UTC `YYYY-MM-DD`: el que nombra el hash de Redis. */
export const metricsDay = (): string => new Date().toISOString().slice(0, 10);

/** Medianoche UTC siguiente: los días UTC caen justo en múltiplos de `DAY_MS` desde el epoch. */
const nextMidnight = (now: number): number => Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;

let currentDay = metricsDay();
let nextRolloverMs = nextMidnight(Date.now());

/**
 * Cierra el día si ya se cruzó medianoche UTC. Se chequea también en `record()` porque `flush()`
 * sólo corre si hay Redis: sin él, el acumulador seguiría sumando días distintos bajo la etiqueta
 * de "hoy" (contradiciendo lo que devuelve `readDay()` para ayer). Es una comparación numérica.
 */
function maybeRollover(now: number = Date.now()): void {
	if (now < nextRolloverMs) return;
	// El umbral primero: aunque algo fallara abajo, el rollover no se reintenta en cada request.
	nextRolloverMs = nextMidnight(now);
	const closed = currentDay;
	currentDay = metricsDay();
	if (buckets.size === 0) return;
	// Se conservan las MISMAS instancias de Bucket: si hay un flush en vuelo, su `b.f` sigue siendo
	// el corte correcto y el próximo volcado no duplica el delta.
	const rows = new Map([...buckets].filter(([, b]) => b.count > b.f.count));
	buckets.clear();
	if (rows.size === 0) return;
	pending.push({ day: closed, rows });
	while (pending.length > MAX_PENDING_DAYS) pending.shift();
}

function newBucket(key: string, owner: string): Bucket {
	const [method = "", url = ""] = key.split(" ");
	const f = { count: 0, ms: 0, bytes: 0, bcount: 0, err: 0 };
	return { method, url, owner, count: 0, sumMs: 0, sumBytes: 0, bytesCount: 0, maxMs: 0, errCount: 0, f };
}

/** `bytes === null` = la respuesta no reportó tamaño (204/304, stream, hijack): no es 0 bytes. */
export function record(key: string, owner: string, ms: number, bytes: number | null, status: number): void {
	if (!config.enabled) return;
	maybeRollover();
	let bucket = buckets.get(key);
	if (!bucket) {
		bucket = newBucket(key, owner);
		buckets.set(key, bucket);
	}
	bucket.count++;
	bucket.sumMs += ms;
	if (bytes !== null) {
		bucket.sumBytes += bytes;
		bucket.bytesCount++;
	}
	if (ms > bucket.maxMs) bucket.maxMs = ms;
	if (status >= 400) bucket.errCount++;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
function toRow(key: string, b: Bucket): EndpointMetricRow {
	const { method, url, owner, count, errCount } = b;
	const d = count || 1;
	// Sólo promedia las respuestas que sí reportaron tamaño; `null` = nunca hubo una.
	const avgBytes = b.bytesCount > 0 ? Math.round(b.sumBytes / b.bytesCount) : null;
	const stats = { avgMs: round2(b.sumMs / d), maxMs: round2(b.maxMs), avgBytes, errRate: round2(errCount / d) };
	return { key, method, url, owner, count, errCount, ...stats };
}

export const snapshot = (): EndpointMetricRow[] => {
	maybeRollover();
	return [...buckets].map(([key, bucket]) => toRow(key, bucket));
};

export function reset(key?: string): number {
	// Rotar antes de borrar: si se cruzó medianoche, lo que hay en `buckets` todavía es de ayer y
	// pertenece a Redis; resetear "hoy" no puede llevárselo puesto.
	maybeRollover();
	if (key) return buckets.delete(key) ? 1 : 0;
	const cleared = buckets.size;
	buckets.clear();
	return cleared;
}

/**
 * Lock de reentrada del flush. `b.f` se actualiza recién DESPUÉS de los `hincrby` de ese
 * bucket, así que dos flushes solapados (Redis lento y el ticker que vuelve a disparar)
 * calcularían el mismo delta dos veces y lo sumarían dos veces al hash del día.
 */
let flushing = false;

/** Vuelca al hash de `day` el delta desde el último flush (por bucket, idempotente). */
async function flushRows(redis: RedisProvider, day: string, rows: Map<string, Bucket>): Promise<void> {
	const hash = `${HASH_PREFIX}${day}`;
	let wrote = false;
	// Copia de las entradas, NO el Map vivo: si un rollover limpia `buckets` durante un `await`, el
	// iterador nativo sigue vivo y entregaría los buckets del día NUEVO para volcarlos en `hash`.
	for (const [key, b] of [...rows]) {
		if (b.count <= b.f.count) continue;
		await redis.hincrby(hash, `${key}|count`, b.count - b.f.count);
		await redis.hincrby(hash, `${key}|ms`, Math.round(b.sumMs - b.f.ms));
		if (b.bytesCount > b.f.bcount) {
			await redis.hincrby(hash, `${key}|bytes`, Math.round(b.sumBytes - b.f.bytes));
			await redis.hincrby(hash, `${key}|bcount`, b.bytesCount - b.f.bcount);
		}
		if (b.errCount > b.f.err) await redis.hincrby(hash, `${key}|err`, b.errCount - b.f.err);
		b.f = { count: b.count, ms: b.sumMs, bytes: b.sumBytes, bcount: b.bytesCount, err: b.errCount };
		wrote = true;
	}
	// El TTL se re-arma en cada volcado: cuesta una llamada y evita rastrear si el hash es nuevo.
	if (wrote) await redis.expire(hash, config.retentionDays * 86_400);
}

/** Vuelca a Redis el delta desde el último flush. Tolerante a fallo: lo no volcado se reintenta solo. */
export async function flush(redis: RedisProvider): Promise<void> {
	if (!config.enabled || flushing) return;
	maybeRollover();
	if (pending.length === 0 && buckets.size === 0) return;
	flushing = true;
	try {
		// Los días cerrados van cada uno a SU hash; si no, su delta caería en el día equivocado.
		while (pending.length > 0) {
			const entry = pending[0];
			await flushRows(redis, entry.day, entry.rows);
			// Sacar SÓLO la entrada que se volcó: durante el `await` puede haber corrido un rollover
			// que, por el tope de días, ya descartó ésta; un `shift()` a ciegas se llevaría puesto
			// (sin volcar) al día que ocupó su lugar.
			if (pending[0] === entry) pending.shift();
		}
		await flushRows(redis, currentDay, buckets);
	} catch {
		// Best-effort: el delta no volcado queda vivo en memoria y se reintenta en el próximo tick.
	} finally {
		flushing = false;
	}
}

/** Reconstruye un día histórico desde el hash de Redis (sin `owner` ni `maxMs`: no se persisten). */
export async function readDay(redis: RedisProvider, day: string): Promise<EndpointMetricRow[]> {
	const raw = await redis.hgetall(`${HASH_PREFIX}${day}`).catch(() => ({}) as Record<string, string>);
	const rows = new Map<string, Bucket>();
	for (const [field, value] of Object.entries(raw ?? {})) {
		const sep = field.lastIndexOf("|");
		if (sep <= 0) continue;
		const key = field.slice(0, sep);
		const bucket = rows.get(key) ?? newBucket(key, "");
		rows.set(key, bucket);
		const n = Number(value) || 0;
		if (field.endsWith("|count")) bucket.count = n;
		else if (field.endsWith("|ms")) bucket.sumMs = n;
		else if (field.endsWith("|bytes")) bucket.sumBytes = n;
		else if (field.endsWith("|bcount")) bucket.bytesCount = n;
		else if (field.endsWith("|err")) bucket.errCount = n;
	}
	// Hashes escritos antes de que existiera `|bcount`: ahí toda request aportaba bytes (0 incluido).
	for (const b of rows.values()) if (b.bytesCount === 0 && b.sumBytes > 0) b.bytesCount = b.count;
	return [...rows].filter(([, b]) => b.count > 0).map(([key, b]) => toRow(key, b));
}
