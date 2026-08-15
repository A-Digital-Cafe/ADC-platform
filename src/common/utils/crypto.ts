import * as crypto from "node:crypto";
import { isRealProduction } from "./runtime-env.ts";

export function generateId(): string {
	return crypto.randomUUID();
}

/**
 * Firma mínima de `Bun.password` (argon2id nativo del runtime; `node:crypto` no expone argon2).
 * Se declara local en vez de depender del global de `@types/bun` porque este archivo lo importa
 * medio árbol, incluidos proyectos cuyo `tsconfig` sólo carga los tipos de node. El kernel corre
 * siempre bajo bun, así que en runtime el global está.
 */
declare const Bun: {
	password: {
		hash(password: string, options: { algorithm: "argon2id"; memoryCost: number; timeCost: number }): Promise<string>;
		verify(password: string, hash: string): Promise<boolean>;
	};
};

/**
 * Perfil argon2id: 64 MiB de memoria y 2 pasadas (recomendación OWASP). El costo en memoria es
 * lo que le saca ventaja a PBKDF2 frente a GPU/ASIC, y encima sale más barato: ~19 ms medidos
 * contra los ~43 ms del PBKDF2-SHA512 de 100k iteraciones que reemplaza.
 */
const ARGON2_MEMORY_COST = 65536;
const ARGON2_TIME_COST = 2;

/** Prefijo del PHC string de `Bun.password`; es el marcador de algoritmo que el formato viejo no tenía. */
const ARGON2_PREFIX = "$argon2";

/** Hashea una contraseña con argon2id. El PHC string resultante lleva algoritmo y parámetros dentro. */
export async function hashPassword(password: string): Promise<string> {
	return Bun.password.hash(password, { algorithm: "argon2id", memoryCost: ARGON2_MEMORY_COST, timeCost: ARGON2_TIME_COST });
}

/**
 * Verifica contra el formato vigente (argon2id) o el legado (PBKDF2).
 *
 * El prefijo se mira ANTES de delegar porque `Bun.password.verify` **lanza**
 * (`UnsupportedAlgorithm`) ante un hash que no reconoce, en vez de devolver `false`: probar
 * primero y catchear convertiría cada login legado en una excepción.
 */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
	if (!passwordHash) return false;
	if (passwordHash.startsWith(ARGON2_PREFIX)) {
		try {
			return await Bun.password.verify(password, passwordHash);
		} catch {
			return false;
		}
	}
	return verifyLegacyPbkdf2(password, passwordHash);
}

/**
 * Lectura del formato legado `<saltHex>:<hashHex>` (PBKDF2-SHA512, 100k, salt de 16 bytes).
 *
 * Es permanente, no una etapa de migración: el rehash sólo puede ocurrir cuando alguien vuelve a
 * escribir su contraseña, y de una cuenta dormida el texto plano ya no existe en ningún lado.
 * Quitar este camino dejaría a su titular sin poder entrar nunca más.
 */
function verifyLegacyPbkdf2(password: string, passwordHash: string): boolean {
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

/**
 * `true` si el hash guardado quedó en el formato legado y conviene reescribirlo. Sólo tiene sentido
 * llamarlo con la contraseña en claro a mano y ya validada (login), que es el único momento en que
 * se puede re-derivar.
 */
export function needsPasswordRehash(passwordHash: string): boolean {
	return !passwordHash?.startsWith(ARGON2_PREFIX);
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

/**
 * HMAC-SHA256 (hex) de una cadena UTF-8: firma tokens de un solo uso y seudonimiza
 * identificadores (`userRef` del archivo de constancias). Sin la clave no se forja ni se revierte.
 */
export function hmacSha256Hex(input: string, key: string | Uint8Array): string {
	return crypto.createHmac("sha256", key).update(input, "utf8").digest("hex");
}

/** Comparación constant-time de dos cadenas hex (firmas/hashes). `false` si alguna no es hex válida. */
export function safeEqualHex(a: string, b: string): boolean {
	if (!/^[0-9a-fA-F]+$/.test(a) || !/^[0-9a-fA-F]+$/.test(b)) return false;
	const ba = Buffer.from(a, "hex");
	const bb = Buffer.from(b, "hex");
	return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

// Cifrado en reposo (AES-256-GCM)

const AT_REST_SCHEME = "aes-256-gcm" as const;
const AT_REST_KEY_LENGTH = 32;
const AT_REST_IV_LENGTH = 12;

/**
 * Master key (KEK) de cifrado en reposo de la plataforma: `ADC_STORAGE_MASTER_KEY`
 * (32 bytes en hex o base64).
 *
 * Fuera de producción real, sin la env var se deriva una clave **determinística** de
 * desarrollo y se avisa. Que sea determinística y no aleatoria es la propiedad importante:
 * una clave efímera por proceso dejaría indescifrable cuanto ya estuviera guardado en cada
 * reinicio o recarga en caliente, y sería directamente inservible con más de una réplica.
 *
 * **En producción real la ausencia es un error de arranque, no una degradación.** La clave
 * de desarrollo es pública (está en este archivo) y no sella sólo adjuntos: vía
 * `createAtRestSealer` sella claves de sesión JWE, refresh tokens, la caché de permisos, el
 * OAuth pendiente y los tokens de los jobs encolados. Con el Redis por defecto sin
 * autenticación, degradar en silencio equivale a guardar esos secretos en claro; y como el
 * envelope es determinístico por clave, un despliegue que arrancó sin ella no se "arregla"
 * configurándola después. Es la misma política que ya declara `.env.example`.
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
	if (isRealProduction()) {
		throw new Error(
			"ADC_STORAGE_MASTER_KEY no configurada: es obligatoria en producción. " +
				"Generar con `openssl rand -hex 32` y mantenerla ESTABLE entre reinicios y réplicas."
		);
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
 * Prefijo de versión del envelope. Existe para poder cambiar el esquema sin volver ilegible lo ya
 * guardado: un valor **sin** prefijo es del formato original (tres partes, sin AAD).
 *
 * Es también donde iría un identificador de clave (`v1:<id>`) el día que haya un llavero. No está
 * porque rotar de verdad exige DOS claves vivas a la vez, y reservar el hueco sin el llavero sería
 * aparentar que la rotación está resuelta: hoy cambiar `ADC_STORAGE_MASTER_KEY` vuelve ilegible lo
 * anterior y el sellador lo trata como «no está» (ver `scripts/rotate-master-key.mjs`).
 */
const AT_REST_ENVELOPE_V1 = "v1";

/** Contexto opcional del sellado. */
export interface AtRestContext {
	/**
	 * Datos autenticados pero **no cifrados**: atan el ciphertext al lugar donde vive.
	 *
	 * Sin esto un valor cifrado sirve en cualquier documento del mismo dominio: GCM garantiza que
	 * esos bytes no se tocaron, nunca que estén donde corresponde, así que quien pueda escribir en la
	 * base copia el secreto del nodo A al documento del nodo B y se abre sin objetar.
	 *
	 * **No es retroactivo**: los valores guardados antes se siguen abriendo sin comprobarlo, y quedan
	 * atados recién cuando se reescriben.
	 */
	aad?: string;
}

/**
 * Cifra un string con AES-256-GCM. Envelope `v1.base64(iv).base64(authTag).base64(ciphertext)`.
 *
 * GCM es autenticado: manipular el ciphertext hace fallar a {@link decryptAtRest}, no
 * devuelve basura. Con `aad`, además, moverlo de contexto también falla.
 *
 * El separador es `.` y ninguna de las partes puede contenerlo (base64 estándar no lo usa y el
 * prefijo de versión tampoco), así que el parseo no es ambiguo.
 */
export function encryptAtRest(plaintext: string, key: Buffer, ctx: AtRestContext = {}): string {
	const iv = crypto.randomBytes(AT_REST_IV_LENGTH);
	const cipher = crypto.createCipheriv(AT_REST_SCHEME, key, iv);
	if (ctx.aad) cipher.setAAD(Buffer.from(ctx.aad, "utf8"));
	const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	return `${AT_REST_ENVELOPE_V1}.${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${sealed.toString("base64")}`;
}

/**
 * Inverso de {@link encryptAtRest}. Lanza si el envelope está corrupto, truncado, alterado o —con
 * `aad`— si viene de otro contexto.
 *
 * Acepta los dos formatos: el de cuatro partes con versión y el original de tres. El de tres se abre
 * **sin** comprobar el AAD aunque se pase, porque se escribió cuando no existía.
 */
export function decryptAtRest(envelope: string, key: Buffer, ctx: AtRestContext = {}): string {
	const parts = envelope.split(".");
	const versioned = parts.length === 4 && parts[0] === AT_REST_ENVELOPE_V1;
	if (!versioned && parts.length !== 3) throw new Error("envelope de cifrado inválido");

	const [iv, authTag, sealed] = versioned ? parts.slice(1) : parts;
	if (!iv || !authTag || !sealed) throw new Error("envelope de cifrado inválido");

	const decipher = crypto.createDecipheriv(AT_REST_SCHEME, key, Buffer.from(iv, "base64"));
	// El AAD va antes del primer `update` (lo exige node) y sólo para los envelopes que se cifraron
	// con él: aplicarlo a uno viejo haría fallar algo perfectamente válido.
	if (versioned && ctx.aad) decipher.setAAD(Buffer.from(ctx.aad, "utf8"));
	decipher.setAuthTag(Buffer.from(authTag, "base64"));
	return Buffer.concat([decipher.update(Buffer.from(sealed, "base64")), decipher.final()]).toString("utf8");
}
