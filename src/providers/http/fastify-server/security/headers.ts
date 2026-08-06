import { isRealProduction } from "@common/utils/runtime-env.ts";
import { ensureCspNonce } from "./csp-nonce.js";

type SecurityHeaders = Record<string, string>;

interface HeaderReply {
	header(name: string, value: string): unknown;
	raw: { removeHeader?: (name: string) => void };
	request?: { hostname?: string; headers?: Record<string, unknown> };
}

/**
 * Enforce por defecto en producción real; la env sólo sirve para forzar o desactivar (mismo
 * patrón que `shouldSendHsts`). Condicionarlo a un opt-in dejaría la política siempre en
 * Report-Only, que sin `report-uri` no bloquea **ni** recolecta nada.
 */
function shouldEnforceCsp(): boolean {
	if (process.env.SECURITY_CSP_ENFORCE) return process.env.SECURITY_CSP_ENFORCE === "true";
	return isRealProduction();
}

function shouldSendHsts(): boolean {
	if (process.env.SECURITY_ENABLE_HSTS) return process.env.SECURITY_ENABLE_HSTS === "true";
	return isRealProduction();
}

function getCspHeaderName(): string {
	return shouldEnforceCsp() ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

function getDefaultCsp(nonce?: string): string {
	// En dev las apps viven en puertos distintos y se acceden tanto por `localhost`
	// como por la IP de LAN (probar desde el móvil). La gramática CSP no admite
	// comodines en hosts IP, así que fuera de producción se abren los esquemas
	// `http:`/`ws:` completos en vez de enumerar orígenes.
	const connectSrc = isRealProduction()
		? "connect-src 'self' https://esm.sh https://*.adigitalcafe.com wss://*.adigitalcafe.com"
		: "connect-src 'self' http: ws: https://esm.sh https://*.adigitalcafe.com wss://*.adigitalcafe.com";
	// Sin `'unsafe-eval'`: nada del runtime lo necesita. rspack compila con `devtool: false` en
	// **producción**, y ni Stencil, ni Vue (se resuelve el build runtime-only), ni el runtime de
	// Module Federation usan `eval`/`new Function`. Si algún día se declaran remotes MF por
	// *manifest*, `@module-federation/sdk` sí evalúa el `getPublicPath` del manifest y habría que
	// revisarlo.
	//
	// En dev el devtool sí es `eval-*`, pero esos bundles los sirve el dev-server de rspack en su
	// propio puerto y nunca pasan por acá. La invariante a sostener es la de prod: un devtool
	// `eval-*` en el build de producción hace que esta CSP bloquee el bundle.
	//
	// Inline: con nonce por request (`csp-nonce.ts` lo genera y lo sella sobre el HTML final en
	// el último hook `onSend`). El `'unsafe-inline'` sólo queda como fallback cuando el nonce
	// está apagado por env — mezclarlos no sirve: en cuanto hay un nonce, el navegador ignora
	// `'unsafe-inline'`.
	const inlineScript = nonce ? `'nonce-${nonce}'` : "'unsafe-inline'";
	const scriptSrc = isRealProduction()
		? `script-src 'self' ${inlineScript} https://esm.sh https://*.adigitalcafe.com`
		: `script-src 'self' ${inlineScript} https://esm.sh http: https://*.adigitalcafe.com`;
	return [
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"form-action 'self'",
		// `'unsafe-inline'` en script-src no cubre los atributos de evento (`onclick=`), y no
		// hay ni uno en el árbol: negarlos es gratis y cierra una clase entera de inyección.
		"script-src-attr 'none'",
		// `https:` en la base y no en el delta de cada app: los avatares salen de hosts externos
		// (DiceBear como fallback, el CDN de Discord) y casi todas las apps repetían esta línea
		// en su config.json — las que no, rompen al enforcear.
		"img-src 'self' data: blob: https:",
		"font-src 'self' data:",
		"style-src 'self' 'unsafe-inline'",
		scriptSrc,
		connectSrc,
		"worker-src 'self' blob:",
		"manifest-src 'self'",
	].join("; ");
}

/**
 * Host de la request, sin puerto y en minúsculas.
 *
 * `headers.host` primero: con `trustProxy` activo `request.hostname` sale de `X-Forwarded-Host`,
 * que el cliente puede mandar, y acá se decide si CORP degrada a `cross-origin`.
 */
function getRequestHost(reply: HeaderReply): string {
	const raw = (reply.request?.headers?.host as string | undefined) || reply.request?.hostname || "";
	return raw.replace(/:\d+$/, "").toLowerCase();
}

/**
 * `same-site` compara **sitios**, y una IP pelada no tiene dominio registrable: Chromium no la
 * considera same-site ni consigo misma, así que bloquea (`ERR_BLOCKED_BY_RESPONSE.NotSameSite`)
 * todo subrecurso `no-cors` que venga de otro puerto —y la plataforma vive repartida en puertos:
 * la preview de Drive sale del gateway :3000 dentro de una página en :3032—. Entrando por IP la
 * única política que permite ese reparto es `cross-origin`. `localhost` no hace falta degradarlo:
 * el navegador lo trata como sitio propio y el cruce de puertos ya funciona.
 *
 * En producción real NUNCA se degrada, aunque se entre por IP: si no, alcanzaría con pedir los
 * recursos por la IP de origen en vez de por el dominio para saltearse CORP entero. Ahí la IP no
 * es un caso de uso —el despliegue va detrás de un dominio— y si alguien la usa, que rompa fuerte
 * es preferible a que afloje callado.
 */
function getResourcePolicy(host: string): string {
	if (isRealProduction()) return "same-site";
	const isIpHost = host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
	return isIpHost ? "cross-origin" : "same-site";
}

function buildDefaultSecurityHeaders(host: string, nonce?: string): SecurityHeaders {
	const headers: SecurityHeaders = {
		[getCspHeaderName()]: getDefaultCsp(nonce),
		"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
		"Cross-Origin-Embedder-Policy": "unsafe-none",
		"Cross-Origin-Opener-Policy": "same-origin",
		"Cross-Origin-Resource-Policy": getResourcePolicy(host),
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

function mergeSecurityHeaders(host: string, nonce?: string, overrides?: SecurityHeaders): SecurityHeaders {
	const merged = { ...buildDefaultSecurityHeaders(host, nonce) };
	const cspOverride = overrides?.["Content-Security-Policy"];
	if (cspOverride !== undefined) {
		delete merged["Content-Security-Policy"];
		delete merged["Content-Security-Policy-Report-Only"];
		if (cspOverride !== "") merged[getCspHeaderName()] = cspOverride;
	}

	// "Content-Security-Policy-Extend": fusiona fuentes/directivas adicionales sobre la
	// CSP por defecto (que ya distingue dev/prod). Evita duplicar la política completa
	// en cada config.json — las apps solo declaran su delta (ej. "img-src https:").
	//
	// "Content-Security-Policy-Restrict": **reemplaza** una directiva de la base en vez de sumarle
	// fuentes. Extend no puede restar —une listas—, así que sin esto una app no tiene forma de
	// cerrar un comodín que la base concede por compatibilidad (ej. `img-src https:`, que está en la
	// base porque casi todas las apps muestran avatares remotos). Se aplica después de Extend: lo
	// que restrinja una directiva gana sobre lo que esa misma directiva haya sumado.
	const cspExtend = overrides?.["Content-Security-Policy-Extend"];
	const cspRestrict = overrides?.["Content-Security-Policy-Restrict"];
	if ((cspExtend || cspRestrict) && cspOverride === undefined) {
		let csp = cspExtend ? extendCsp(getDefaultCsp(nonce), cspExtend) : getDefaultCsp(nonce);
		if (cspRestrict) csp = restrictCsp(csp, cspRestrict);
		merged[getCspHeaderName()] = csp;
	}

	for (const [name, value] of Object.entries(overrides ?? {})) {
		if (name === "Content-Security-Policy" || name === "Content-Security-Policy-Extend" || name === "Content-Security-Policy-Restrict") {
			continue;
		}
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

/**
 * Reemplaza directivas completas de una política ("dir src1 src2; dir2 ..."), en vez de sumarles
 * fuentes como hace `extendCsp`. Una directiva sin fuentes (`"object-src"`) la deja vacía, que es
 * la forma de negarla. Las directivas no mencionadas quedan como estaban.
 */
function restrictCsp(baseCsp: string, restriction: string): string {
	const directives = new Map<string, string>();
	for (const part of baseCsp.split(";")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const [name, ...values] = trimmed.split(/\s+/);
		directives.set(name, values.join(" "));
	}
	for (const part of restriction.split(";")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const [name, ...values] = trimmed.split(/\s+/);
		directives.set(name, values.join(" "));
	}
	return [...directives.entries()].map(([name, value]) => (value ? `${name} ${value}` : name)).join("; ");
}

export function applySecurityHeaders(reply: HeaderReply, overrides?: SecurityHeaders): void {
	(reply.raw as any).removeHeader?.("X-Powered-By");
	// El nonce se ancla a la request: `serveStaticFile` vuelve a llamar acá después del hook
	// `onRequest`, y las dos veces tiene que salir el MISMO valor o el header final no
	// coincidiría con el HTML sellado.
	const nonce = ensureCspNonce(reply.request);
	for (const [name, value] of Object.entries(mergeSecurityHeaders(getRequestHost(reply), nonce, overrides))) {
		reply.header(name, value);
	}
}
