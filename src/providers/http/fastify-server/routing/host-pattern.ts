import type { FastifyRequest } from "fastify";

/**
 * Convierte un patrón de host a regex
 * "*.local.com" -> /^(.+)\.local\.com$/
 * "cloud.local.com" -> /^cloud\.local\.com$/
 */
export function hostPatternToRegex(pattern: string): RegExp {
	const escaped = pattern.replaceAll(".", String.raw`\.`).replaceAll("*", "(.+)");
	return new RegExp(`^${escaped}$`, "i");
}

/**
 * Calcula la prioridad de un patrón de host
 * Patrones más específicos tienen mayor prioridad
 */
export function calculatePriority(pattern: string, explicitPriority?: number): number {
	if (explicitPriority !== undefined) return explicitPriority;

	// Comodines tienen menor prioridad
	const wildcardCount = (pattern.match(/\*/g) || []).length;
	const parts = pattern.split(".");
	const specificity = parts.length * 10 - wildcardCount * 100;

	return specificity;
}

/** Host de la request sin puerto y en minúsculas. */
export function stripPort(host: string): string {
	return host.split(":")[0].toLowerCase();
}

/**
 * Host de la request para el ruteo por vhost.
 *
 * `headers.host` **antes** que `request.hostname`: con `trustProxy` activo fastify deriva
 * `hostname` de `X-Forwarded-Host`, que el cliente puede mandar (el edge reenvía los headers
 * desconocidos tal cual). `trustProxy` tiene que afectar a `request.ip`, no al ruteo.
 */
export function requestHostname(request: FastifyRequest): string {
	return stripPort(request.headers.host || request.hostname || "");
}
