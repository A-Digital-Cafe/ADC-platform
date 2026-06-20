import type { RegisteredEndpoint } from "../types.js";

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
