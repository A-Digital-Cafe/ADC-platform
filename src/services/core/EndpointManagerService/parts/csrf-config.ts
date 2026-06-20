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
	const enabled = parseBoolean(options.enabled, true);
	const rawSecret = options.secret || undefined;

	if (enabled && process.env.NODE_ENV === "production" && !rawSecret) {
		throw new Error("CSRF_SECRET is required when CSRF is enabled in production");
	}

	return {
		enabled,
		secret: rawSecret ? Buffer.from(rawSecret) : FALLBACK_SECRET,
		ttlSeconds: parseTtl(options.ttlSeconds),
		secureCookie: parseBoolean(options.secureCookie, defaultSecureCookie()),
	};
}
