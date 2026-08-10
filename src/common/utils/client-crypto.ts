/**
 * Utilidades criptográficas para entornos de navegador.
 * No dependen de `node:crypto` para ser compatibles con bundlers frontend.
 *
 * `crypto.randomUUID` sólo existe en contextos seguros (https o localhost); en una LAN por http
 * plano o en WebViews embebidas es `undefined` y llamarlo tira `TypeError`. Por eso se degrada
 * siempre: `randomUUID` → `getRandomValues` → `Math.random` (último recurso, sólo ids de UI).
 */

/** Devuelve el `crypto` del entorno, o `undefined` si no existe. */
function webCrypto(): Crypto | undefined {
	return globalThis.crypto ?? undefined;
}

/** 16 bytes aleatorios con el mejor origen disponible. */
function randomBytes16(): Uint8Array {
	const bytes = new Uint8Array(16);
	const c = webCrypto();
	if (typeof c?.getRandomValues === "function") {
		c.getRandomValues(bytes);
		return bytes;
	}
	// NOSONAR: fallback no criptográfico para identificadores de UI (nunca secretos).
	for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	return bytes;
}

/** Genera un UUID v4 completo. */
export function createClientId(): string {
	const c = webCrypto();
	if (typeof c?.randomUUID === "function") return c.randomUUID();

	const bytes = randomBytes16();
	bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** @public Genera un identificador corto de 12 caracteres hexadecimales. */
export function shortId(): string {
	return createClientId().replaceAll("-", "").slice(0, 12);
}
