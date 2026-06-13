import { createCipheriv, createDecipheriv, randomBytes, scryptSync, type CipherGCM, type DecipherGCM } from "node:crypto";
import type { Connection, Model, Schema } from "mongoose";

/**
 * Envelope encryption por usuario para binarios en S3:
 * - Cada usuario tiene una DEK (data encryption key, 32 bytes) generada al
 *   primer uso y guardada ENVUELTA (AES-256-GCM) por la master key (KEK).
 * - Cada objeto se cifra con la DEK de su dueño + IV aleatorio por objeto.
 * Comprometer el bucket S3 no expone datos; comprometer una DEK expone solo a
 * ese usuario en esa app (cada consumer usa su propia colección de claves).
 */

const DEK_LENGTH = 32;
const IV_LENGTH = 12;

export const ENCRYPTION_SCHEME = "aes-256-gcm" as const;

interface UserKeyDoc {
	_id: string;
	/** base64(iv) . base64(authTag) . base64(dek cifrada con la KEK). */
	wrappedKey: string;
	keyVersion: number;
	createdAt: Date;
}

/**
 * Master key (KEK) de cifrado en reposo: `ADC_STORAGE_MASTER_KEY` (32 bytes en
 * hex o base64). Sin la env var se deriva una clave determinística de
 * desarrollo y se loguea una advertencia: NO usar ese fallback en producción.
 */
export function resolveStorageMasterKey(logger?: { logWarn(msg: string): void }): Buffer {
	const raw = process.env.ADC_STORAGE_MASTER_KEY?.trim();
	if (raw) {
		if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
		const b64 = Buffer.from(raw, "base64");
		if (b64.length === DEK_LENGTH) return b64;
		throw new Error("ADC_STORAGE_MASTER_KEY inválida: se esperan 32 bytes en hex (64 chars) o base64");
	}
	logger?.logWarn(
		"ADC_STORAGE_MASTER_KEY no configurada: usando una master key de desarrollo derivada. " +
			"Configurala en producción (32 bytes hex/base64) o el cifrado en reposo será predecible."
	);
	return scryptSync("adc-platform-dev-storage-key", "adc-storage-kek", DEK_LENGTH);
}

export interface UserKeyStoreOptions {
	connection: Connection;
	/** Colección de DEKs envueltas (una por app consumidora, ej: "drive_user_keys"). */
	collectionName: string;
	masterKey: Buffer;
}

/** Cache simple acotado de DEKs desenvueltas (evita scrypt/Mongo por request). */
const KEY_CACHE_MAX = 500;

export class UserKeyStore {
	readonly #model: Model<UserKeyDoc>;
	readonly #masterKey: Buffer;
	readonly #cache = new Map<string, Buffer>();

	constructor(opts: UserKeyStoreOptions) {
		if (opts.masterKey.length !== DEK_LENGTH) throw new Error("masterKey debe ser de 32 bytes");
		this.#masterKey = opts.masterKey;
		this.#model = getOrCreateUserKeyModel(opts.connection, opts.collectionName);
	}

	/** DEK del usuario; la crea (envuelta) si aún no existe. */
	async getUserKey(userId: string): Promise<Buffer> {
		if (!userId) throw new Error("userId requerido para resolver la DEK");
		const cached = this.#cache.get(userId);
		if (cached) return cached;

		let doc = await this.#model.findById(userId).lean<UserKeyDoc | null>();
		if (!doc) {
			const dek = randomBytes(DEK_LENGTH);
			try {
				await this.#model.create({ _id: userId, wrappedKey: this.#wrap(dek), keyVersion: 1, createdAt: new Date() });
				this.#remember(userId, dek);
				return dek;
			} catch (e) {
				// Carrera entre requests concurrentes: el primero gana, releer.
				if ((e as { code?: number }).code !== 11000) throw e;
				doc = await this.#model.findById(userId).lean<UserKeyDoc | null>();
				if (!doc) throw e;
			}
		}
		const dek = this.#unwrap(doc.wrappedKey);
		this.#remember(userId, dek);
		return dek;
	}

	/** Borra la DEK de un usuario (purga de cuenta: sus binarios quedan indescifrables). */
	async deleteUserKey(userId: string): Promise<void> {
		this.#cache.delete(userId);
		await this.#model.deleteOne({ _id: userId });
	}

	#remember(userId: string, dek: Buffer): void {
		if (this.#cache.size >= KEY_CACHE_MAX) {
			const oldest = this.#cache.keys().next().value;
			if (oldest !== undefined) this.#cache.delete(oldest);
		}
		this.#cache.set(userId, dek);
	}

	#wrap(dek: Buffer): string {
		const iv = randomBytes(IV_LENGTH);
		const cipher = createCipheriv(ENCRYPTION_SCHEME, this.#masterKey, iv);
		const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
		return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${wrapped.toString("base64")}`;
	}

	#unwrap(wrappedKey: string): Buffer {
		const [iv, authTag, wrapped] = wrappedKey.split(".");
		if (!iv || !authTag || !wrapped) throw new Error("wrappedKey corrupta");
		const decipher = createDecipheriv(ENCRYPTION_SCHEME, this.#masterKey, Buffer.from(iv, "base64"));
		decipher.setAuthTag(Buffer.from(authTag, "base64"));
		return Buffer.concat([decipher.update(Buffer.from(wrapped, "base64")), decipher.final()]);
	}
}

/** Cipher de streaming para un objeto nuevo: IV aleatorio + AES-256-GCM con la DEK. */
export function createObjectCipher(dek: Buffer): { iv: Buffer; cipher: CipherGCM } {
	const iv = randomBytes(IV_LENGTH);
	return { iv, cipher: createCipheriv(ENCRYPTION_SCHEME, dek, iv) };
}

/** Decipher de streaming para un objeto cifrado (auth tag verificado al final del stream). */
export function createObjectDecipher(dek: Buffer, ivB64: string, authTagB64: string): DecipherGCM {
	const decipher = createDecipheriv(ENCRYPTION_SCHEME, dek, Buffer.from(ivB64, "base64"));
	decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
	return decipher;
}

function getOrCreateUserKeyModel(connection: Connection, collectionName: string): Model<UserKeyDoc> {
	const modelName = `UserKey_${collectionName}`;
	try {
		return connection.model<UserKeyDoc>(modelName);
	} catch {
		const SchemaCtor = (connection as Connection & { base: { Schema: typeof import("mongoose").Schema } }).base.Schema;
		const schema: Schema<UserKeyDoc> = new SchemaCtor<UserKeyDoc>(
			{
				_id: { type: String, required: true },
				wrappedKey: { type: String, required: true, maxlength: 200 },
				keyVersion: { type: Number, required: true, default: 1 },
				createdAt: { type: Date, required: true, default: () => new Date() },
			},
			{ versionKey: false, collection: collectionName }
		);
		return connection.model<UserKeyDoc>(modelName, schema);
	}
}
