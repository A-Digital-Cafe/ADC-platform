import type { RegisteredEndpoint } from "../types.js";

interface RuntimeRateLimit {
	max: number;
	timeWindow: number;
}

const MUTATIVE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_READ_MAX = 600;
const DEFAULT_MUTATION_MAX = 120;
const DEFAULT_WINDOW_MS = 60_000;

function isDisabled(): boolean {
	return ["0", "false", "off", "no"].includes((process.env.ENDPOINT_RATE_LIMIT_ENABLED || "true").toLowerCase());
}

function readPositiveInteger(name: string, fallback: number): number {
	const parsed = Number(process.env[name]);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalize(limit: RuntimeRateLimit): RuntimeRateLimit | null {
	if (!Number.isFinite(limit.max) || !Number.isFinite(limit.timeWindow)) return null;
	if (limit.max <= 0 || limit.timeWindow <= 0) return null;
	return { max: Math.floor(limit.max), timeWindow: Math.floor(limit.timeWindow) };
}

export function resolveRateLimit(endpoint: RegisteredEndpoint): RuntimeRateLimit | null {
	const explicit = endpoint.options?.rateLimit;
	if (explicit) return normalize(explicit);

	// Endpoints públicos (sin permisos) SIEMPRE reciben el límite por defecto:
	// el kill-switch global ENDPOINT_RATE_LIMIT_ENABLED no aplica a superficies sin auth.
	const isPublic = (endpoint.permissions?.length ?? 0) === 0;
	if (!isPublic && isDisabled()) return null;

	const isMutation = MUTATIVE_METHODS.has(endpoint.method);
	return {
		max: readPositiveInteger(
			isMutation ? "ENDPOINT_RATE_LIMIT_MUTATION_MAX" : "ENDPOINT_RATE_LIMIT_READ_MAX",
			isMutation ? DEFAULT_MUTATION_MAX : DEFAULT_READ_MAX
		),
		timeWindow: readPositiveInteger("ENDPOINT_RATE_LIMIT_WINDOW_MS", DEFAULT_WINDOW_MS),
	};
}
