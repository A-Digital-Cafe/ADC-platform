import { randomBytes } from "node:crypto";

export interface CsrfOptions {
	enabled?: boolean | string;
	secret?: string;
	ttlSeconds?: number | string;
	secureCookie?: boolean | string;
}

export interface CsrfRuntimeConfig {
	enabled: boolean;
	secret: Buffer;
	ttlSeconds: number;
	secureCookie: boolean;
}

const FALLBACK_SECRET = randomBytes(32);

function env(name: string, adcName: string): string | undefined {
	return process.env[name] ?? process.env[adcName];
}

function parseBoolean(value: boolean | string | undefined, defaultValue: boolean): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string" || value.trim() === "") return defaultValue;
	return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function parseTtl(value: number | string | undefined): number {
	const ttl = Number(value || 7200);
	return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 7200;
}

function defaultSecureCookie(): boolean {
	return process.env.NODE_ENV === "production" && process.env.PROD_PORT !== "3000";
}

export function resolveCsrfConfig(options: CsrfOptions = {}): CsrfRuntimeConfig {
	const enabled = parseBoolean(options.enabled ?? env("CSRF_ENABLED", "ADC_CSRF_ENABLED"), true);
	const rawSecret = options.secret || env("CSRF_SECRET", "ADC_CSRF_SECRET");

	if (enabled && process.env.NODE_ENV === "production" && !rawSecret) {
		throw new Error("CSRF_SECRET is required when CSRF is enabled in production");
	}

	return {
		enabled,
		secret: rawSecret ? Buffer.from(rawSecret) : FALLBACK_SECRET,
		ttlSeconds: parseTtl(options.ttlSeconds ?? env("CSRF_TTL_SECONDS", "ADC_CSRF_TTL_SECONDS")),
		secureCookie: parseBoolean(options.secureCookie ?? env("CSRF_SECURE_COOKIE", "ADC_CSRF_SECURE_COOKIE"), defaultSecureCookie()),
	};
}
