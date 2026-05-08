type SecurityHeaders = Record<string, string>;

interface HeaderReply {
	header(name: string, value: string): unknown;
	raw: { removeHeader?: (name: string) => void };
}

function shouldEnforceCsp(): boolean {
	return process.env.SECURITY_CSP_ENFORCE === "true";
}

function shouldSendHsts(): boolean {
	if (process.env.SECURITY_ENABLE_HSTS) return process.env.SECURITY_ENABLE_HSTS === "true";
	return process.env.NODE_ENV === "production" && process.env.PROD_PORT !== "3000";
}

function getCspHeaderName(): string {
	return shouldEnforceCsp() ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

function getDefaultCsp(): string {
	return [
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"form-action 'self'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"style-src 'self' 'unsafe-inline'",
		"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://esm.sh",
		"connect-src 'self' http://localhost:* ws://localhost:* https://esm.sh",
		"worker-src 'self' blob:",
		"manifest-src 'self'",
	].join("; ");
}

function buildDefaultSecurityHeaders(): SecurityHeaders {
	const headers: SecurityHeaders = {
		[getCspHeaderName()]: getDefaultCsp(),
		"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
		"Cross-Origin-Embedder-Policy": "unsafe-none",
		"Cross-Origin-Opener-Policy": "same-origin",
		"Cross-Origin-Resource-Policy": "same-site",
		"Origin-Agent-Cluster": "?1",
		"Referrer-Policy": "strict-origin-when-cross-origin",
		"X-Content-Type-Options": "nosniff",
		"X-DNS-Prefetch-Control": "off",
		"X-Download-Options": "noopen",
		"X-Frame-Options": "DENY",
		"X-Permitted-Cross-Domain-Policies": "none",
		"X-XSS-Protection": "0",
	};

	if (shouldSendHsts()) {
		headers["Strict-Transport-Security"] = "max-age=15552000; includeSubDomains";
	}

	return headers;
}

function mergeSecurityHeaders(overrides?: SecurityHeaders): SecurityHeaders {
	const merged = { ...buildDefaultSecurityHeaders() };
	const cspOverride = overrides?.["Content-Security-Policy"];
	if (cspOverride !== undefined) {
		delete merged["Content-Security-Policy"];
		delete merged["Content-Security-Policy-Report-Only"];
		if (cspOverride !== "") merged[getCspHeaderName()] = cspOverride;
	}

	for (const [name, value] of Object.entries(overrides ?? {})) {
		if (name === "Content-Security-Policy") continue;
		if (value === "") delete merged[name];
		else merged[name] = value;
	}
	return merged;
}

export function applySecurityHeaders(reply: HeaderReply, overrides?: SecurityHeaders): void {
	(reply.raw as any).removeHeader?.("X-Powered-By");
	for (const [name, value] of Object.entries(mergeSecurityHeaders(overrides))) {
		reply.header(name, value);
	}
}
