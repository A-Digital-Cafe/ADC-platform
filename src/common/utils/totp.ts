import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) sobre HOTP (RFC 4226) y Base32 (RFC 4648), sin dependencias.
 *
 * Los parámetros son los que asumen por defecto Google Authenticator, Aegis, 1Password y el resto:
 * SHA-1, 6 dígitos, ventana de 30 s. **No son negociables**: `otpauth://` admite declararlos, pero
 * varias apps ignoran los parámetros no estándar y calcularían otro código sin avisar.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Duración de cada paso, en segundos. */
const TOTP_PERIOD_SECONDS = 30;
/** Dígitos del código. */
const TOTP_DIGITS = 6;
/** Bytes de entropía del secreto (160 bits = tamaño del bloque de HMAC-SHA1). */
const TOTP_SECRET_BYTES = 20;

/**
 * Pasos de tolerancia hacia atrás y hacia adelante. Uno solo (±30 s) cubre el desfasaje de reloj
 * habitual del teléfono; subirlo agranda linealmente la ventana en la que sirve un código robado.
 */
const TOTP_WINDOW_STEPS = 1;

/** Alfabeto de los códigos de recuperación: sin 0/O ni 1/I/L, que se transcriben mal. */
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/**
 * 15 símbolos = ~74 bits. Se guardan con SHA-256 y no con argon2id: verificar un código exige
 * probarlo contra los 10 hashes, y diez derivaciones argon2 por intento serían un DoS en el propio
 * login. El endurecimiento acá es la entropía —2^74 no se recorre ni con la base filtrada—, que un
 * valor aleatorio puede permitirse y una contraseña elegida por una persona no.
 */
const RECOVERY_GROUPS = 3;
const RECOVERY_GROUP_LEN = 5;

function base32Encode(bytes: Uint8Array): string {
	let out = "";
	let buffer = 0;
	let bits = 0;

	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += BASE32_ALPHABET[(buffer >> bits) & 31];
		}
	}
	// Sin padding `=`: los lectores de `otpauth://` lo aceptan igual y varios lo rechazan.
	if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];

	return out;
}

/** Decodifica Base32 tolerando minúsculas, espacios y padding. Lanza si aparece un símbolo ajeno. */
function base32Decode(input: string): Buffer {
	const clean = input.toUpperCase().replaceAll(/[\s=-]/g, "");
	const bytes: number[] = [];
	let buffer = 0;
	let bits = 0;

	for (const char of clean) {
		const value = BASE32_ALPHABET.indexOf(char);
		if (value < 0) throw new Error(`Base32 inválido: '${char}'`);
		buffer = (buffer << 5) | value;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((buffer >> bits) & 0xff);
		}
	}

	return Buffer.from(bytes);
}

/** Secreto TOTP nuevo, en Base32 (el formato que espera `otpauth://`). */
export function generateTotpSecret(): string {
	return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** Paso (contador HOTP) correspondiente a un instante. */
export function totpStep(atMs: number = Date.now()): number {
	return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** Código de 6 dígitos para un paso concreto, con ceros a la izquierda. */
function generateTotpCode(secret: string, step: number): string {
	const counter = Buffer.alloc(8);
	// El contador es de 64 bits; `writeBigUInt64BE` evita el desborde de los enteros de 32 bits.
	counter.writeBigUInt64BE(BigInt(step));

	const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();

	// Truncamiento dinámico (RFC 4226 §5.3).
	const offset = digest[digest.length - 1] & 0x0f;
	const binary =
		((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);

	return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

/** Quita separadores y espacios: los autenticadores muestran `123 456` y se pega tal cual. */
function normalizeTotpCode(raw: string | undefined): string {
	return (raw || "").replaceAll(/\D/g, "");
}

interface VerifyOptions {
	/** Instante de referencia (test/relojes). */
	atMs?: number;
	/**
	 * Último paso ya consumido por esta cuenta. Los pasos <= a éste se rechazan aunque el código
	 * sea correcto: sin esto, un código interceptado sirve las veces que quepan en su ventana.
	 */
	lastStep?: number;
}

/**
 * Verifica un código y devuelve el paso que lo generó, o `null`. Se devuelve el paso (y no un
 * booleano) porque quien llama **tiene que persistirlo** como `lastStep` para cerrar el replay.
 */
export function verifyTotpCode(secret: string, code: string, options: VerifyOptions = {}): number | null {
	const candidate = normalizeTotpCode(code);
	if (candidate.length !== TOTP_DIGITS) return null;

	const current = totpStep(options.atMs);
	const candidateBuffer = Buffer.from(candidate, "utf8");

	for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset++) {
		const step = current + offset;
		if (options.lastStep !== undefined && step <= options.lastStep) continue;

		const expected = Buffer.from(generateTotpCode(secret, step), "utf8");
		if (timingSafeEqual(expected, candidateBuffer)) return step;
	}

	return null;
}

/**
 * URI `otpauth://` para el QR. El `issuer` va duplicado (en la etiqueta y como parámetro) porque
 * las apps viejas sólo leen el prefijo de la etiqueta y las nuevas sólo el parámetro.
 *
 * `algorithm`, `digits` y `period` se omiten a propósito: los valores que usamos son exactamente
 * los que asume el formato cuando faltan, así que declararlos no cambia ningún código y suma ~45
 * caracteres — los que hacen saltar el QR dos versiones y lo vuelven bastante más difícil de
 * escanear. Si alguna vez dejan de ser los de arriba, hay que empezar a declararlos.
 */
export function buildOtpauthUri(options: { secret: string; account: string; issuer: string }): string {
	const label = encodeURIComponent(`${options.issuer}:${options.account}`);
	// `encodeURIComponent` y no `URLSearchParams`: ésta codifica el espacio como `+`, que sólo
	// significa espacio en un formulario. Varias apps decodifican la query como URI y terminan
	// mostrando "ADC+Platform" como nombre del emisor.
	const issuer = encodeURIComponent(options.issuer);
	return `otpauth://totp/${label}?secret=${options.secret}&issuer=${issuer}`;
}

/** Códigos de recuperación de un solo uso, en claro (se guardan hasheados). */
export function generateRecoveryCodes(count: number): string[] {
	const codes: string[] = [];
	for (let i = 0; i < count; i++) {
		const groups: string[] = [];
		for (let g = 0; g < RECOVERY_GROUPS; g++) {
			// `randomInt` y no `randomBytes % 31`: el módulo sobre un alfabeto que no divide a 256
			// sesga los primeros símbolos, y acá el rechazo lo hace `node:crypto` gratis.
			const chars = Array.from({ length: RECOVERY_GROUP_LEN }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]);
			groups.push(chars.join(""));
		}
		codes.push(groups.join("-"));
	}
	return codes;
}

/** Normaliza un código de recuperación tipeado (mayúsculas, sin guiones ni espacios). */
export function normalizeRecoveryCode(raw: string | undefined): string {
	return (raw || "").toUpperCase().replaceAll(/[^0-9A-Z]/g, "");
}
