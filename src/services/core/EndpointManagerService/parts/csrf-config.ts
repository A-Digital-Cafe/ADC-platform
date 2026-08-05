import { randomBytes } from "node:crypto";
import { isRealProduction } from "@common/utils/runtime-env.ts";

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
	return isRealProduction();
}

export function resolveCsrfConfig(options: CsrfOptions = {}): CsrfRuntimeConfig {
	const enabled = parseBoolean(options.enabled, true);
	const rawSecret = options.secret || undefined;

	// `isRealProduction()` y no `NODE_ENV` a secas, para que `start:prodtests` arranque (servicio
	// `failOnError: true`). Ahí el secreto cae al aleatorio de proceso: CSRF sigue activo, pero sus
	// tokens no sobreviven a un reinicio.
	if (enabled && isRealProduction() && !rawSecret) {
		throw new Error("CSRF_SECRET is required when CSRF is enabled in production");
	}

	return {
		enabled,
		secret: rawSecret ? Buffer.from(rawSecret) : FALLBACK_SECRET,
		ttlSeconds: parseTtl(options.ttlSeconds),
		secureCookie: parseBoolean(options.secureCookie, defaultSecureCookie()),
	};
}
