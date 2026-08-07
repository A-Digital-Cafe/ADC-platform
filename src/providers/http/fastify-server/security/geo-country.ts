import { isTrustedProxyPeer } from "./trusted-proxies.js";

/**
 * País del visitante según Cloudflare, publicado al cliente como `window.__ADC_COUNTRY__`.
 *
 * Vive en el provider HTTP porque es la única capa que puede decidir si el `CF-IPCountry` es
 * creíble: el header lo pone Cloudflare, pero cualquiera puede mandarlo a mano si la request no
 * entró por un proxy de la allowlist. Misma regla que usa `GeoIPValidator` para revocar sesiones.
 *
 * Se inyecta en el HTML en vez de exponerse por un endpoint para no agregar un viaje por render
 * ni una clave de almacenamiento nueva que después haya que declarar en la política de cookies.
 */

const CF_IPCOUNTRY_HEADER = "cf-ipcountry";

/** Códigos que Cloudflare usa para "no sé" (`XX`) y para salidas de Tor (`T1`). */
const UNKNOWN_COUNTRIES = new Set(["XX", "T1"]);

interface CountryRequest {
	headers: Record<string, string | string[] | undefined>;
	socket?: { remoteAddress?: string };
}

/** Código ISO de dos letras, o `null` si no se puede afirmar. */
export function countryFromRequest(request: CountryRequest): string | null {
	if (!isTrustedProxyPeer(request.socket?.remoteAddress)) return null;

	const raw = request.headers[CF_IPCOUNTRY_HEADER];
	const country = (Array.isArray(raw) ? raw[0] : raw)?.toUpperCase();
	if (!country || UNKNOWN_COUNTRIES.has(country)) return null;

	return /^[A-Z]{2}$/.test(country) ? country : null;
}

/**
 * Inserta `window.__ADC_COUNTRY__` al inicio del `<head>`. Devuelve el HTML intacto si no hay
 * país que publicar, así una respuesta sin Cloudflare delante queda byte a byte igual.
 */
export function injectCountry(html: string, country: string | null): string {
	if (!country || !/<head[^>]*>/i.test(html)) return html;
	const tag = `<script>window.__ADC_COUNTRY__=${JSON.stringify(country)}</script>`;
	return html.replace(/<head[^>]*>/i, (head) => `${head}${tag}`);
}
