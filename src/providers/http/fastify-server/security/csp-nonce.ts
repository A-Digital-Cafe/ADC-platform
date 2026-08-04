import { randomBytes } from "node:crypto";

/**
 * Nonce CSP por request.
 *
 * `script-src` cargaba `'unsafe-inline'` porque la plataforma sirve scripts inline que no se
 * pueden hashear: el `<script type="importmap">` que UIFederation escribe en el HTML de cada
 * módulo, el `window.__ADC_PLATFORM__` que inyecta el modules-manager en `onSend`, el JSON-LD
 * del SEOService y los scripts de redirect responsive / dark-mode. Con `'unsafe-inline'`
 * cualquier XSS reflejado o almacenado ejecuta, que es justo lo que la CSP debería impedir.
 *
 * El nonce se genera una vez por request y se guarda en el propio objeto request bajo un
 * Symbol, para que el header (que se escribe en `onRequest`) y el sellado del HTML (que
 * ocurre en `onSend`) usen exactamente el mismo valor.
 *
 * **Un nonce hace que el navegador ignore `'unsafe-inline'`** (CSP2+): en cuanto se emite,
 * cualquier `<script>` inline sin sellar deja de ejecutar. Por eso el sellado es un barrido
 * final sobre el HTML completo y no una lista de puntos de inyección — y por eso existe la
 * palanca `SECURITY_CSP_SCRIPT_NONCE=false`, que vuelve al comportamiento anterior sin
 * necesidad de un despliegue.
 */

const NONCE_KEY = Symbol.for("adc.csp.nonce");

/** 16 bytes: el mínimo que recomienda la spec de CSP para un nonce impredecible. */
const NONCE_BYTES = 16;

interface NonceCarrier {
	[NONCE_KEY]?: string;
}

/** `false` desactiva el nonce y restaura `'unsafe-inline'` en `script-src`. */
export function isCspNonceEnabled(): boolean {
	return process.env.SECURITY_CSP_SCRIPT_NONCE !== "false";
}

/**
 * Nonce de esta request, generándolo la primera vez. `undefined` si el nonce está apagado o
 * no hay request a la que anclarlo (llamadas sintéticas): sin anclaje, el header y el HTML
 * usarían valores distintos y no ejecutaría nada.
 */
export function ensureCspNonce(request: unknown): string | undefined {
	if (!isCspNonceEnabled() || !request || typeof request !== "object") return undefined;
	const carrier = request as NonceCarrier;
	carrier[NONCE_KEY] ??= randomBytes(NONCE_BYTES).toString("base64");
	return carrier[NONCE_KEY];
}

/** Nonce ya generado para esta request, sin crear uno nuevo. */
export function getCspNonce(request: unknown): string | undefined {
	if (!request || typeof request !== "object") return undefined;
	return (request as NonceCarrier)[NONCE_KEY];
}

/**
 * `<script` sin atributo `nonce`. Se sellan también los que tienen `src`: no lo necesitan
 * (los cubre `'self'`/los hosts declarados) pero marcarlos no cambia nada y evita depender
 * de distinguirlos bien.
 */
const UNSEALED_SCRIPT = /<script\b(?![^>]*\bnonce=)/gi;

/**
 * Agrega `nonce="…"` a cada `<script>` inline del HTML.
 *
 * Corre como ÚLTIMO hook `onSend`, así que ve el HTML final: el de disco (con su import map)
 * más lo que hayan inyectado SEOService y el modules-manager. Hacerlo en cada punto de
 * inyección dejaría fuera el HTML estático, que es donde vive el import map.
 */
export function stampCspNonce(html: string, nonce: string): string {
	return html.replaceAll(UNSEALED_SCRIPT, `<script nonce="${nonce}"`);
}
