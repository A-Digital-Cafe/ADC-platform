import { isPrivateHost } from "@common/utils/url-utils.js";

export const ALLOWED_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export const ALLOWED_CORS_HEADERS = ["Content-Type", "Authorization", "Idempotency-Key", "X-CSRF-Token", "X-Requested-With"];

function parseOriginList(): string[] {
	const raw = process.env.CORS_ALLOWED_ORIGINS || process.env.ADC_CORS_ALLOWED_ORIGINS || "";
	return raw
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

/**
 * Origen de desarrollo: localhost/loopback **o IP privada de LAN** (probar desde el
 * móvil contra `bun run dev` implica origen `http://192.168.x.x:<puerto-app>`).
 * Misma regla que `IS_DEV` del front (`@common/utils/url-utils`): si el cliente se
 * considera en dev y manda `credentials: "include"`, el server debe aceptar ese origen.
 */
function isLocalOrigin(origin: string): boolean {
	try {
		const { hostname } = new URL(origin);
		return hostname === "::1" || isPrivateHost(hostname);
	} catch {
		return false;
	}
}

function hostPatternMatches(pattern: string, hostname: string): boolean {
	const escaped = pattern.replaceAll(".", String.raw`\.`).replaceAll("*", "[^.]+?");
	return new RegExp(`^${escaped}$`, "i").test(hostname);
}

function originMatchesRegisteredHost(origin: string, hosts: string[]): boolean {
	try {
		const { hostname } = new URL(origin);
		return hosts.some((host) => hostPatternMatches(host, hostname));
	} catch {
		return false;
	}
}

export function createCorsOriginGuard(isDevelopment: boolean, getRegisteredHosts: () => string[]) {
	const configuredOrigins = parseOriginList();
	return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
		if (!origin) return callback(null, true);
		if (isDevelopment && isLocalOrigin(origin)) return callback(null, true);
		if (configuredOrigins.includes(origin)) return callback(null, true);
		return callback(null, originMatchesRegisteredHost(origin, getRegisteredHosts()));
	};
}

export function isAllowedHttpMethod(method: string): boolean {
	return (ALLOWED_HTTP_METHODS as readonly string[]).includes(method.toUpperCase());
}

export function getAllowHeader(): string {
	return ALLOWED_HTTP_METHODS.join(", ");
}
