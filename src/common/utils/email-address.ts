/**
 * Utilidades de direcciones de correo compartidas (única fuente de verdad).
 *
 * Las usan el `EmailService` (validación de envío, entrega entrante) y el
 * frontend `adc-mail` (validación en el compose). No reimplementarlas.
 */

/** Dirección con al menos un punto en el dominio (RFC 5322 simplificada). */
const EMAIL_RX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** @public */
export function isValidEmailAddress(address: string): boolean {
	return EMAIL_RX.test(address.trim());
}

/** Parte local y dominio de una dirección, o `null` si no tiene un `@` usable. */
function splitAddress(address: string): { local: string; domain: string } | null {
	const at = address.lastIndexOf("@");
	if (at <= 0 || at === address.length - 1) return null;
	return { local: address.slice(0, at), domain: address.slice(at + 1) };
}

/**
 * Normaliza una dirección para comparar/buscar buzones: recorta, pasa a
 * minúsculas y descarta el **subaddressing** (`usuario+etiqueta@dominio` →
 * `usuario@dominio`), que es la misma casilla. Devuelve la entrada recortada y
 * en minúsculas si no puede interpretarla.
 */
export function normalizeAddress(address: string): string {
	const trimmed = address.trim().toLowerCase();
	const parts = splitAddress(trimmed);
	if (!parts) return trimmed;
	const plus = parts.local.indexOf("+");
	const local = plus === -1 ? parts.local : parts.local.slice(0, plus);
	// `+etiqueta` sin parte local (`+tag@dominio`) no identifica buzón alguno:
	// se deja tal cual para que la búsqueda falle en lugar de resolver a `@dominio`.
	if (!local) return trimmed;
	return `${local}@${parts.domain}`;
}

/**
 * `true` si la dirección pertenece al dominio de correo de la plataforma: el
 * dominio raíz o cualquier subdominio de organización (`<org>.<raíz>`).
 */
export function isInternalAddress(address: string, rootDomain: string): boolean {
	const parts = splitAddress(address.trim().toLowerCase());
	if (!parts) return false;
	const root = rootDomain.trim().toLowerCase();
	return parts.domain === root || parts.domain.endsWith(`.${root}`);
}
