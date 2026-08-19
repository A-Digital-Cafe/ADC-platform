import type { FastifyInstance } from "fastify";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import {
	countryFromRequest,
	getCspNonce,
	hasGpcOptOut,
	hasMalformedBeaconToken,
	injectCountry,
	injectWebAnalytics,
	isCspNonceEnabled,
	stampCspNonce,
	webAnalyticsSnippet,
} from "../security/index.js";

/**
 * HTML de la respuesta como string, o `null` si no hay que tocarla.
 *
 * String o Buffer: los archivos estáticos se sirven con `readFileSync` (Buffer) salvo que un
 * inyector previo (SEO, modules-manager) ya lo haya pasado a string. Los streams se dejan pasar:
 * no hay ninguna respuesta HTML que los use.
 */
function htmlPayload(payload: unknown): string | null {
	if (typeof payload === "string") return payload;
	if (Buffer.isBuffer(payload)) return payload.toString("utf8");
	return null;
}

/**
 * Publica el país del visitante como `window.__ADC_COUNTRY__`. Se registra antes que el sellador
 * de nonce para que el `<script>` que inserta quede sellado y el navegador lo ejecute.
 *
 * El `Vary` no es opcional: sin él, una caché intermedia serviría el HTML de un visitante
 * argentino a uno de afuera, y al revés.
 */
export function installCountryInjector(app: FastifyInstance<any>): void {
	app.addHook("onSend", (request, reply, payload, done) => {
		try {
			const contentType = String(reply.getHeader("content-type") ?? "");
			if (!contentType.includes("text/html")) return done(null, payload);

			// El `Vary` va SIEMPRE, aunque no haya país: si sólo se marcara la respuesta que lleva
			// el script, una caché podría guardar la versión sin país y devolvérsela a alguien
			// cuyo país sí conocemos.
			reply.header("Vary", [reply.getHeader("Vary"), "CF-IPCountry"].filter(Boolean).join(", "));

			const country = countryFromRequest(request as unknown as Parameters<typeof countryFromRequest>[0]);
			if (!country) return done(null, payload);

			const html = htmlPayload(payload);
			return done(null, html === null ? payload : injectCountry(html, country));
		} catch {
			return done(null, payload);
		}
	});
}

/**
 * Sella con el nonce CSP los `<script>` inline del HTML servido, e inyecta la analítica. Se
 * instala desde `listen()` y no en `setupMiddleware` a propósito: los hooks `onSend` corren en
 * orden de registro y fastify no admite ninguno después de `listen()`, así que registrarlo justo
 * antes de escuchar lo deja ÚLTIMO — ve el HTML final, con el import map del archivo en disco más
 * lo que inyectaron SEOService y el modules-manager. Registrado antes, esas inyecciones
 * posteriores quedarían sin sellar y el navegador las bloquearía.
 */
export function installCspNonceSealer(app: FastifyInstance<any>, logger: ILogger): void {
	const nonceEnabled = isCspNonceEnabled();
	const analytics = webAnalyticsSnippet();
	if (hasMalformedBeaconToken()) {
		logger.logWarn("ADC_CF_BEACON_TOKEN no tiene forma de token de Cloudflare (32 hexadecimales): no se inyecta el beacon.");
	}
	if (!nonceEnabled && !analytics) return;

	app.addHook("onSend", (request, reply, payload, done) => {
		try {
			const nonce = getCspNonce(request);
			if (!nonce && !analytics) return done(null, payload);
			const contentType = String(reply.getHeader("content-type") ?? "");
			if (!contentType.includes("text/html")) return done(null, payload);
			let html = htmlPayload(payload);
			if (html === null) return done(null, payload);

			// La analítica va ANTES del sellado, para que el nonce alcance también a su script.
			// `Sec-GPC: 1` la saltea: es la única forma de honrar la señal, porque el beacon que
			// inyecta el borde (RUM automático) sale después de este proceso y sin este dato.
			if (analytics && !hasGpcOptOut(request)) html = injectWebAnalytics(html, analytics);
			if (nonce) html = stampCspNonce(html, nonce);
			return done(null, html);
		} catch {
			// Nunca romper una respuesta por el sellado: sin nonce el navegador bloquea los
			// inline, pero un 500 acá tiraría la página entera.
			return done(null, payload);
		}
	});
}
