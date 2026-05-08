import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "@common/types/ADCCustomError.js";
import type { FastifyRequest, IHostBasedHttpProvider } from "../../../../interfaces/modules/providers/IHttpServer.js";
import type { HttpMethod, RegisteredEndpoint, SetCookie } from "../types.js";
import type { CsrfRuntimeConfig } from "./csrf-config.js";

export type TokenSource = "cookie" | "bearer" | "query" | null;

const CSRF_COOKIE_NAME = "adc_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_TOKEN_PATH = "/api/csrf-token";
const MUTATIVE_METHODS: ReadonlySet<HttpMethod> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function signNonce(nonce: string, config: CsrfRuntimeConfig): string {
	return createHmac("sha256", config.secret).update(nonce).digest("base64url");
}

function createCsrfToken(config: CsrfRuntimeConfig): string {
	const nonce = randomBytes(32).toString("base64url");
	return `${nonce}.${signNonce(nonce, config)}`;
}

function getCookieOptions(config: CsrfRuntimeConfig): SetCookie["options"] {
	return { httpOnly: true, secure: config.secureCookie, sameSite: "strict", path: "/", maxAge: config.ttlSeconds };
}

function getHeaderValue(req: FastifyRequest<any>, name: string): string | undefined {
	const value = req.headers[name] ?? (req.headers as Record<string, unknown>)[name.toUpperCase()];
	return Array.isArray(value) ? value[0] : typeof value === "string" ? value : undefined;
}

function hasBrowserCookie(req: FastifyRequest<any>): boolean {
	const cookies = ((req as any).cookies || {}) as Record<string, string | undefined>;
	return Object.keys(cookies).length > 0;
}

function isValidToken(token: string, config: CsrfRuntimeConfig): boolean {
	const [nonce, signature] = token.split(".");
	if (!nonce || !signature) return false;
	const expected = signNonce(nonce, config);
	const left = Buffer.from(signature);
	const right = Buffer.from(expected);
	return left.length === right.length && timingSafeEqual(left, right);
}

export function registerCsrfEndpoint(httpProvider: IHostBasedHttpProvider, config: CsrfRuntimeConfig): void {
	if (!config.enabled) return;
	httpProvider.registerRoute("GET", CSRF_TOKEN_PATH, (_req: unknown, reply: any) => {
		const csrfToken = createCsrfToken(config);
		reply.setCookie?.(CSRF_COOKIE_NAME, csrfToken, getCookieOptions(config));
		reply.header("Cache-Control", "no-store");
		reply.send({ csrfToken });
	});
}

export function validateCsrf(endpoint: RegisteredEndpoint, req: FastifyRequest<any>, tokenSource: TokenSource, config: CsrfRuntimeConfig): void {
	if (!config.enabled || !MUTATIVE_METHODS.has(endpoint.method) || endpoint.options?.skipCsrf === true) return;
	if (getHeaderValue(req, "authorization")) return;
	if (tokenSource !== "cookie" && !hasBrowserCookie(req)) return;

	const headerToken = getHeaderValue(req, CSRF_HEADER_NAME);
	const cookieToken = (((req as any).cookies || {}) as Record<string, string | undefined>)[CSRF_COOKIE_NAME];
	if (!headerToken || !cookieToken) throw new HttpError(403, "CSRF_TOKEN_MISSING", "CSRF token is required");
	if (headerToken !== cookieToken || !isValidToken(headerToken, config))
		throw new HttpError(403, "CSRF_TOKEN_INVALID", "CSRF token is invalid");
}
