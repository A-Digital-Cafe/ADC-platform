// TOTP para el login de dev. Las cuentas con rol de administración no pueden entrar sin segundo
// factor (por diseño), así que el driver tiene que poder resolverlo solo o deja de servir para
// probar cualquier pantalla de admin.
//
// El secreto se guarda en `temp/` en claro a propósito: son las credenciales de dev que ya están
// escritas en `config.mjs`, y el archivo vive fuera de git. Nada de esto corre en producción.
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Paso de 30 s al que pertenece un instante. Es la unidad que el server marca como consumida. */
export function totpStep(atMs = Date.now()) {
	return Math.floor(atMs / 30_000);
}

/** Espejo de `src/common/utils/totp.ts` (SHA-1, 6 dígitos, ventana de 30 s). */
export function totpCode(secret, atMs = Date.now()) {
	let buffer = 0;
	let bits = 0;
	const bytes = [];
	for (const char of secret.toUpperCase().replaceAll(/[\s=-]/g, "")) {
		buffer = (buffer << 5) | BASE32.indexOf(char);
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((buffer >> bits) & 0xff);
		}
	}

	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
	const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();

	const offset = digest[19] & 0x0f;
	const binary =
		((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
	return String(binary % 1_000_000).padStart(6, "0");
}

const STORE = "temp/.adc-2fa-secrets.json";

function readStore() {
	try {
		return JSON.parse(readFileSync(STORE, "utf8"));
	} catch {
		return {};
	}
}

/** El formato viejo guardaba el secreto pelado; el nuevo es `{ secret, lastStep }`. */
function entryOf(username) {
	const raw = readStore()[username];
	if (!raw) return null;
	return typeof raw === "string" ? { secret: raw } : raw;
}

export function getSecret(username) {
	return entryOf(username)?.secret || null;
}

export function saveSecret(username, secret) {
	writeEntry(username, { ...entryOf(username), secret });
}

/**
 * Último paso que el server marcó como consumido para este usuario.
 *
 * Hace falta porque el segundo factor tiene guard de replay (`verifyTotpCode` descarta todo paso
 * `<= lastStep`, y el DAO lo persiste en cada verificación exitosa): dos logins dentro del mismo
 * paso de 30 s fallan SIEMPRE en el segundo, aunque el código sea correcto. Sin este dato el driver
 * lo vive como un `INVALID_TOTP` intermitente.
 */
export function getLastStep(username) {
	return entryOf(username)?.lastStep ?? null;
}

export function saveLastStep(username, lastStep) {
	writeEntry(username, { ...entryOf(username), lastStep });
}

function writeEntry(username, entry) {
	mkdirSync(dirname(STORE), { recursive: true });
	writeFileSync(STORE, JSON.stringify({ ...readStore(), [username]: entry }, null, 2));
}
