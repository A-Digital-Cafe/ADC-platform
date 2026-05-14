/**
 * Utilidades criptográficas para entornos de navegador.
 * No dependen de `node:crypto` para ser compatibles con bundlers frontend.
 */

/** Genera un UUID v4 completo. */
export function createClientId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Genera un identificador corto de 12 caracteres hexadecimales. */
export function shortId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
	}
	return Math.random().toString(36).slice(2, 14);
}
