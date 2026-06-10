type SecurityHeaders = Record<string, string>;

interface HeaderReply {
	header(name: string, value: string): unknown;
	raw: { removeHeader?: (name: string) => void };
}

function shouldEnforceCsp(): boolean {
	return process.env.SECURITY_CSP_ENFORCE === "true";
}

/** Producción real: NODE_ENV=production y NO el modo local de pruebas (start:prodtests usa PROD_PORT=3000). */
function isRealProduction(): boolean {
	return process.env.NODE_ENV === "production" && process.env.PROD_PORT !== "3000";
}

function shouldSendHsts(): boolean {
	if (process.env.SECURITY_ENABLE_HSTS) return process.env.SECURITY_ENABLE_HSTS === "true";
	return isRealProduction();
}

function getCspHeaderName(): string {
	return shouldEnforceCsp() ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

function getDefaultCsp(): string {
	const connectSrc = isRealProduction()
		? "connect-src 'self' https://esm.sh https://*.adigitalcafe.com wss://*.adigitalcafe.com"
		: "connect-src 'self' http://localhost:* ws://localhost:* https://esm.sh https://*.adigitalcafe.com wss://*.adigitalcafe.com";
	const scriptSrc = isRealProduction()
		? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://esm.sh https://*.adigitalcafe.com"
		: "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://esm.sh http://localhost:* https://*.adigitalcafe.com";
	return [
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"form-action 'self'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"style-src 'self' 'unsafe-inline'",
		scriptSrc,
		connectSrc,
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

	// "Content-Security-Policy-Extend": fusiona fuentes/directivas adicionales sobre la
	// CSP por defecto (que ya distingue dev/prod). Evita duplicar la política completa
	// en cada config.json — las apps solo declaran su delta (ej. "img-src https:").
	const cspExtend = overrides?.["Content-Security-Policy-Extend"];
	if (cspExtend && cspOverride === undefined) {
		merged[getCspHeaderName()] = extendCsp(getDefaultCsp(), cspExtend);
	}

	for (const [name, value] of Object.entries(overrides ?? {})) {
		if (name === "Content-Security-Policy" || name === "Content-Security-Policy-Extend") continue;
		if (value === "") delete merged[name];
		else merged[name] = value;
	}
	return merged;
}

/** Fusiona una extensión CSP ("dir src1 src2; dir2 ...") sobre una política base. */
function extendCsp(baseCsp: string, extension: string): string {
	const directives = new Map<string, string>();
	for (const part of baseCsp.split(";")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const [name, ...values] = trimmed.split(/\s+/);
		directives.set(name, values.join(" "));
	}
	for (const part of extension.split(";")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const [name, ...values] = trimmed.split(/\s+/);
		const addition = values.join(" ");
		const existing = directives.get(name);
		if (existing === undefined) directives.set(name, addition);
		else if (addition && !existing.includes(addition)) directives.set(name, `${existing} ${addition}`);
	}
	return [...directives.entries()].map(([name, value]) => (value ? `${name} ${value}` : name)).join("; ");
}

export function applySecurityHeaders(reply: HeaderReply, overrides?: SecurityHeaders): void {
	(reply.raw as any).removeHeader?.("X-Powered-By");
	for (const [name, value] of Object.entries(mergeSecurityHeaders(overrides))) {
		reply.header(name, value);
	}
}
