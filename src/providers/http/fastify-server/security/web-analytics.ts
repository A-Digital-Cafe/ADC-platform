/**
 * Beacon de Cloudflare Web Analytics, inyectado **por la plataforma** y no por el borde.
 *
 * Cloudflare sabe inyectarlo solo (RUM en modo automático), pero entonces reescribe el HTML después
 * de que salió de este proceso: la decisión de medir o no queda fuera de nuestro alcance y no hay
 * forma de tomarla por request. Con el modo «Enable with JS Snippet installation» el borde no toca
 * nada y el snippet lo ponemos acá, que es lo que permite respetar `Sec-GPC`.
 *
 * El token **no es un secreto**: viaja en el HTML de cada página. Va por variable de entorno para
 * que cada despliegue mida en su propia cuenta, no para ocultarlo.
 */

/** Los tokens de Cloudflare son 32 hexadecimales. Validarlo evita medir contra el vacío por un pegado a medias. */
const TOKEN_RE = /^[a-f0-9]{32}$/i;

/**
 * `Sec-GPC: 1` — Global Privacy Control. El visitante declara, a nivel navegador, que no quiere que
 * su información se venda ni se comparta. Se respeta en cada request y no hace falta persistirlo: el
 * navegador lo manda siempre, así que no hay estado que guardar ni que se pueda desincronizar.
 */
export function hasGpcOptOut(request: unknown): boolean {
	const headers = (request as { headers?: Record<string, unknown> } | null)?.headers;
	const raw = headers?.["sec-gpc"];
	const value = Array.isArray(raw) ? raw[0] : raw;
	return String(value ?? "").trim() === "1";
}

/** El `<script>` del beacon, o `null` si no hay token configurado (o no tiene forma de token). */
export function webAnalyticsSnippet(): string | null {
	const token = process.env.ADC_CF_BEACON_TOKEN?.trim();
	if (!token || !TOKEN_RE.test(token)) return null;
	return `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${token}"}'></script>`;
}

/** `true` cuando hay un token configurado pero es inválido: el provider lo avisa una vez al arrancar. */
export function hasMalformedBeaconToken(): boolean {
	const token = process.env.ADC_CF_BEACON_TOKEN?.trim();
	return Boolean(token) && !TOKEN_RE.test(token!);
}

/**
 * Mete el snippet justo antes de `</body>`: después del contenido, para no retrasar el render, y
 * dentro del documento, que es lo que el beacon necesita. Un HTML sin `</body>` (una respuesta
 * parcial, un fragmento) se deja intacto.
 */
export function injectWebAnalytics(html: string, snippet: string): string {
	const closing = html.lastIndexOf("</body>");
	if (closing === -1) return html;
	return html.slice(0, closing) + snippet + html.slice(closing);
}
