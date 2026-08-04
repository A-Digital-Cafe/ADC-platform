import * as crypto from "node:crypto";

export function generateId(): string {
	return crypto.randomUUID();
}

export function hashPassword(password: string): string {
	const salt = crypto.randomBytes(16).toString("hex");
	const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
	return `${salt}:${hash}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
	const [salt, hash] = passwordHash.split(":");
	if (!salt || !hash) return false;
	const computed = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512");
	let expected: Buffer;
	try {
		expected = Buffer.from(hash, "hex");
	} catch {
		return false;
	}
	// Comparación constant-time para evitar timing attacks
	return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}

export function generateRandomCredentials(): { username: string; password: string } {
	return {
		username: `system_${crypto.randomBytes(4).toString("hex")}`,
		password: crypto.randomBytes(16).toString("hex"),
	};
}

export function shortId(): string {
	return crypto.randomBytes(6).toString("hex");
}

/**
 * SHA-256 (hex) de una cadena UTF-8. Usado para el log público de transparencia
 * del bug bounty: el hash se publica al crear el ticket y la descripción se revela
 * al resolverse; cualquiera puede recomputar `sha256Hex(descripción)` y verificar
 * que coincide con el hash original (prueba de no-manipulación).
 */
export function sha256Hex(input: string): string {
	return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * SHA-256 crudo (32 bytes) de una cadena UTF-8, para derivar claves simétricas de
 * largo fijo a partir de un secreto de configuración de largo arbitrario.
 *
 * Preferirlo a rellenar/truncar el secreto: el padding no agrega entropía y el truncado
 * la tira. No sustituye a un KDF con sal para material derivado de contraseñas de usuario.
 */
export function sha256Bytes(input: string): Uint8Array {
	return new Uint8Array(crypto.createHash("sha256").update(input, "utf8").digest());
}

// ─────────────────────────────────────────────────────────────────────────────
// Cifrado en reposo (AES-256-GCM)
// ─────────────────────────────────────────────────────────────────────────────

const AT_REST_SCHEME = "aes-256-gcm" as const;
const AT_REST_KEY_LENGTH = 32;
const AT_REST_IV_LENGTH = 12;

/**
 * Master key (KEK) de cifrado en reposo de la plataforma: `ADC_STORAGE_MASTER_KEY`
 * (32 bytes en hex o base64).
 *
 * Sin la env var se deriva una clave **determinística** de desarrollo y se avisa. Que sea
 * determinística y no aleatoria es la propiedad importante: una clave efímera por proceso
 * dejaría indescifrable cuanto ya estuviera guardado en cada reinicio o recarga en caliente,
 * y sería directamente inservible con más de una réplica.
 *
 * Es una de las dos excepciones de `process.env` en el árbol (junto con `NODE_ENV`): es un
 * secreto de plataforma, no configuración de un módulo, y lo comparten consumidores que no
 * se conocen entre sí.
 */
export function resolveAtRestMasterKey(logger?: { logWarn(msg: string): void }): Buffer {
	const raw = process.env.ADC_STORAGE_MASTER_KEY?.trim();
	if (raw) {
		if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
		const b64 = Buffer.from(raw, "base64");
		if (b64.length === AT_REST_KEY_LENGTH) return b64;
		throw new Error("ADC_STORAGE_MASTER_KEY inválida: se esperan 32 bytes en hex (64 chars) o base64");
	}
	logger?.logWarn(
		"ADC_STORAGE_MASTER_KEY no configurada: usando una master key de desarrollo derivada. " +
			"Configurala en producción (32 bytes hex/base64) o el cifrado en reposo será predecible."
	);
	return crypto.scryptSync("adc-platform-dev-storage-key", "adc-storage-kek", AT_REST_KEY_LENGTH);
}

/**
 * Sub-clave de 32 bytes para un uso concreto, separada por dominio.
 *
 * Cada consumidor de la master key deriva la suya con su propia etiqueta, de modo que
 * comprometer el material de un uso no entrega el de los demás y una rotación de etiqueta
 * invalida sólo ese uso.
 */
export function deriveAtRestKey(masterKey: Buffer, label: string): Buffer {
	return crypto.createHash("sha256").update(masterKey).update(label, "utf8").digest();
}

/**
 * Cifra un string con AES-256-GCM. Envelope `base64(iv).base64(authTag).base64(ciphertext)`,
 * el mismo formato que usa el envoltorio de DEKs de attachments.
 *
 * GCM es autenticado: manipular el ciphertext hace fallar a {@link decryptAtRest}, no
 * devuelve basura.
 */
export function encryptAtRest(plaintext: string, key: Buffer): string {
	const iv = crypto.randomBytes(AT_REST_IV_LENGTH);
	const cipher = crypto.createCipheriv(AT_REST_SCHEME, key, iv);
	const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${sealed.toString("base64")}`;
}

/** Inverso de {@link encryptAtRest}. Lanza si el envelope está corrupto, truncado o alterado. */
export function decryptAtRest(envelope: string, key: Buffer): string {
	const [iv, authTag, sealed] = envelope.split(".");
	if (!iv || !authTag || !sealed) throw new Error("envelope de cifrado inválido");
	const decipher = crypto.createDecipheriv(AT_REST_SCHEME, key, Buffer.from(iv, "base64"));
	decipher.setAuthTag(Buffer.from(authTag, "base64"));
	return Buffer.concat([decipher.update(Buffer.from(sealed, "base64")), decipher.final()]).toString("utf8");
}
