import { createHmac } from "node:crypto";

/**
 * Helpers para hashear identificadores (email / IP) sin almacenar PII.
 *
 * Reglas:
 *  - HMAC-SHA256 con pepper desde `BAN_HASH_PEPPER` (env). Si no está definido,
 *    se usa una pepper de desarrollo y se loguea un warning en el primer uso.
 *  - Email se normaliza ANTES del hash:
 *      - trim + lowercase
 *      - se elimina todo después del primer '+' en el local-part
 *      - para Gmail / GoogleMail (incluye `googlemail.com`), se eliminan los puntos del local-part
 *  - IP se normaliza:
 *      - IPv4 mapped IPv6 (`::ffff:1.2.3.4`) → IPv4
 *      - lowercase + trim
 *
 * El hash devuelve hex (64 chars). Hashes truncados NO se usan: queremos cero
 * colisiones en lookups.
 */

const DEV_FALLBACK_PEPPER = "adc-dev-insecure-pepper-change-me";
let warnedAboutDevPepper = false;

function getPepper(): string {
	const pepper = process.env.BAN_HASH_PEPPER || Bun.env?.BAN_HASH_PEPPER;
	if (pepper && pepper.length >= 16) return pepper;
	if (!warnedAboutDevPepper) {
		warnedAboutDevPepper = true;
		console.warn("[identityHash] BAN_HASH_PEPPER no configurado (o < 16 chars). " + "Usando pepper de desarrollo. NO usar en producción.");
	}
	return DEV_FALLBACK_PEPPER;
}

function hmacHex(label: string, value: string): string {
	return createHmac("sha256", getPepper()).update(`${label}:${value}`).digest("hex");
}

/**
 * Normaliza un email para hashing anti-evasión.
 * `hola+22@gmail.com` → `hola@gmail.com`
 * `h.o.l.a@gmail.com` → `hola@gmail.com` (solo gmail/googlemail)
 */
function normalizeEmail(rawEmail: string): string {
	if (typeof rawEmail !== "string") return "";
	const trimmed = rawEmail.trim().toLowerCase();
	const atIdx = trimmed.lastIndexOf("@");
	if (atIdx <= 0 || atIdx === trimmed.length - 1) return trimmed;

	let local = trimmed.slice(0, atIdx);
	const domain = trimmed.slice(atIdx + 1);

	// Strip "+alias"
	const plusIdx = local.indexOf("+");
	if (plusIdx >= 0) local = local.slice(0, plusIdx);

	// Gmail / googlemail: quitar puntos del local-part
	if (domain === "gmail.com" || domain === "googlemail.com") {
		local = local.replaceAll(".", "");
	}

	if (!local) return trimmed;
	return `${local}@${domain}`;
}

/**
 * Hash estable de un email (anti-evasión). Devuelve `null` si el email es vacío
 * tras normalizar.
 */
function hashEmail(rawEmail: string): string | null {
	const normalized = normalizeEmail(rawEmail);
	if (!normalized?.includes("@")) return null;
	return hmacHex("email", normalized);
}

/**
 * Devuelve hashes únicos a partir de una lista de emails (descartando vacíos
 * y duplicados post-normalización).
 */
export function hashEmails(emails: ReadonlyArray<string | undefined | null>): string[] {
	const out = new Set<string>();
	for (const e of emails) {
		if (!e) continue;
		const h = hashEmail(e);
		if (h) out.add(h);
	}
	return [...out];
}

function normalizeIp(rawIp: string): string {
	if (typeof rawIp !== "string") return "";
	let ip = rawIp.trim().toLowerCase();
	// IPv4-mapped IPv6
	if (ip.startsWith("::ffff:")) ip = ip.slice("::ffff:".length);
	return ip;
}

export function hashIp(rawIp: string): string | null {
	const normalized = normalizeIp(rawIp);
	if (!normalized) return null;
	return hmacHex("ip", normalized);
}
