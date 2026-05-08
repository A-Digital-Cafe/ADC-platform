export const ALLOWED_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export const ALLOWED_CORS_HEADERS = ["Content-Type", "Authorization", "Idempotency-Key", "X-CSRF-Token", "X-Requested-With"];

function parseOriginList(): string[] {
	const raw = process.env.CORS_ALLOWED_ORIGINS || process.env.ADC_CORS_ALLOWED_ORIGINS || "";
	return raw
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

function isLocalOrigin(origin: string): boolean {
	try {
		const url = new URL(origin);
		return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
	} catch {
		return false;
	}
}

function hostPatternMatches(pattern: string, hostname: string): boolean {
	const escaped = pattern.replaceAll(".", "\\.").replaceAll("*", "[^.]+?");
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
