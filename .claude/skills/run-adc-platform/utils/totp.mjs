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

export function getSecret(username) {
	return readStore()[username] || null;
}

export function saveSecret(username, secret) {
	mkdirSync(dirname(STORE), { recursive: true });
	writeFileSync(STORE, JSON.stringify({ ...readStore(), [username]: secret }, null, 2));
}
