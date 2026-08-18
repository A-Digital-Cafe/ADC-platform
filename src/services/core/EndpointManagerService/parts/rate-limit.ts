import type { RegisteredEndpoint } from "../types.js";
import type RedisProvider from "../../../../providers/queue/redis/index.ts";

interface RuntimeRateLimit {
	max: number;
	timeWindow: number;
}

/** Config cruda (proviene de `config.json` → `private.rateLimit`, valores string interpolados). */
export interface RateLimitConfig {
	enabled?: boolean | string;
	readMax?: number | string;
	mutationMax?: number | string;
	windowMs?: number | string;
}

/** Config resuelta y tipada que se calcula una vez al iniciar el servicio. */
export interface ResolvedRateLimits {
	enabled: boolean;
	readMax: number;
	mutationMax: number;
	windowMs: number;
}

const MUTATIVE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_READ_MAX = 600;
const DEFAULT_MUTATION_MAX = 120;
const DEFAULT_WINDOW_MS = 60_000;

function parseBoolean(value: boolean | string | undefined, defaultValue: boolean): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string" || value.trim() === "") return defaultValue;
	return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: number | string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Resuelve la config de rate limit declarada en `config.json` (sin `process.env`). */
export function resolveRateLimitConfig(config: RateLimitConfig = {}): ResolvedRateLimits {
	return {
		enabled: parseBoolean(config.enabled, true),
		readMax: parsePositiveInteger(config.readMax, DEFAULT_READ_MAX),
		mutationMax: parsePositiveInteger(config.mutationMax, DEFAULT_MUTATION_MAX),
		windowMs: parsePositiveInteger(config.windowMs, DEFAULT_WINDOW_MS),
	};
}

function normalize(limit: RuntimeRateLimit): RuntimeRateLimit | null {
	if (!Number.isFinite(limit.max) || !Number.isFinite(limit.timeWindow)) return null;
	if (limit.max <= 0 || limit.timeWindow <= 0) return null;
	return { max: Math.floor(limit.max), timeWindow: Math.floor(limit.timeWindow) };
}

export function resolveRateLimit(endpoint: RegisteredEndpoint, limits: ResolvedRateLimits): RuntimeRateLimit | null {
	const explicit = endpoint.options?.rateLimit;
	if (explicit) return normalize(explicit);

	// Endpoints públicos (sin permisos) SIEMPRE reciben el límite por defecto:
	// el kill-switch global ENDPOINT_RATE_LIMIT_ENABLED no aplica a superficies sin auth.
	const isPublic = (endpoint.permissions?.length ?? 0) === 0;
	if (!isPublic && !limits.enabled) return null;

	const isMutation = MUTATIVE_METHODS.has(endpoint.method);
	return normalize({
		max: isMutation ? limits.mutationMax : limits.readMax,
		timeWindow: limits.windowMs,
	});
}


/**
 * Ventana fija en memoria: respaldo del contador de Redis.
 *
 * Existe porque el límite NO puede simplemente desaparecer cuando Redis no está: los endpoints
 * públicos (sin permisos) lo llevan siempre, y son justo la superficie que no se puede dejar
 * abierta. Cuenta por proceso, así que con varios nodos el límite efectivo se multiplica por la
 * cantidad de nodos — peor que el contador global, infinitamente mejor que ninguno.
 */
const FALLBACK_MAX_KEYS = 20_000;
const fallbackWindows = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitDecision {
	/** Peticiones en la ventana, contando ésta. */
	count: number;
	/** El contador salió de la memoria del proceso porque Redis no respondió. */
	degraded: boolean;
}

function consumeInMemory(key: string, ttlSeconds: number): number {
	const now = Date.now();
	let entry = fallbackWindows.get(key);

	if (entry && entry.resetAt <= now) {
		fallbackWindows.delete(key);
		entry = undefined;
	}

	if (!entry) {
		if (fallbackWindows.size >= FALLBACK_MAX_KEYS) {
			for (const [otherKey, other] of fallbackWindows) {
				if (other.resetAt <= now) fallbackWindows.delete(otherKey);
			}
			// Sigue lleno: se dejan de admitir claves NUEVAS en vez de vaciar el mapa. Vaciarlo
			// borraría justo el contador de quien está inundando; esto lo conserva.
			if (fallbackWindows.size >= FALLBACK_MAX_KEYS) return 1;
		}
		entry = { count: 0, resetAt: now + ttlSeconds * 1000 };
		fallbackWindows.set(key, entry);
	}

	entry.count += 1;
	return entry.count;
}

/**
 * Incrementa el contador de la ventana. **Nunca lanza**: si Redis no responde cae al contador en
 * memoria en vez de dejar la request colgada (que es lo que hacía cuando el cliente encolaba los
 * comandos del socket caído) o de tumbarla con un 500.
 */
export async function consumeRateLimit(redis: RedisProvider | null, key: string, ttlSeconds: number): Promise<RateLimitDecision> {
	if (redis) {
		try {
			return { count: await redis.incrWithTtl(key, ttlSeconds), degraded: false };
		} catch {
			/* degrada a memoria */
		}
	}
	return { count: consumeInMemory(key, ttlSeconds), degraded: true };
}

/** Ritmo del aviso de degradación: el hot path no puede escribir una línea de log por request. */
const DEGRADED_WARN_INTERVAL_MS = 60_000;
let lastDegradedWarnAt = 0;

/** `true` como mucho una vez por minuto, para que el aviso de "rate limit en memoria" no ahogue el log. */
export function shouldWarnDegraded(): boolean {
	const now = Date.now();
	if (now - lastDegradedWarnAt < DEGRADED_WARN_INTERVAL_MS) return false;
	lastDegradedWarnAt = now;
	return true;
}
