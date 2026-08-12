import { createCipheriv, createDecipheriv, randomBytes, type CipherGCM, type DecipherGCM } from "node:crypto";
import type { Connection, Model, Schema } from "mongoose";
import { resolveAtRestMasterKey } from "../../../../common/utils/crypto.js";

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

const ENCRYPTION_SCHEME = "aes-256-gcm" as const;

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
 *
 * Alias del resolvedor compartido de `@common/utils/crypto`: todo el cifrado en reposo de la
 * plataforma (DEKs de attachments, sobres de Redis) deriva de esta misma master key.
 */
export const resolveStorageMasterKey = resolveAtRestMasterKey;

export interface UserKeyStoreOptions {
	connection: Connection;
	/** Colección de DEKs envueltas (una por app consumidora, ej: "drive_user_keys"). */
	collectionName: string;
	masterKey: Buffer;
}

/** Cache simple acotado de DEKs desenvueltas (evita scrypt/Mongo por request). */
const KEY_CACHE_MAX = 500;

/**
 * Vigencia de una DEK cacheada. Del orden de los minutos y no de las horas: una sesión de subida o
 * descarga hace muchos accesos seguidos y no tiene sentido re-desenvolver en cada uno, pero la
 * ventana en la que un nodo ajeno a la purga puede seguir descifrando tiene que ser corta (el
 * porqué, en el docstring de `UserKeyStore`). Re-desenvolver cuesta un `findById` + un AES-GCM,
 * así que acortarla es barato.
 */
const KEY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Almacén de las DEKs envueltas, con cache en memoria acotada **y con vencimiento**.
 *
 * El TTL no es una micro-optimización, no sacarlo: con varios nodos kernel contra la misma base la
 * purga de cuenta corre en uno solo (lease de líder), que borra la DEK de Mongo y de *su* memoria
 * mientras los demás siguen con la clave en RAM y pueden descifrar los binarios del usuario hasta
 * que la entrada caiga por presión FIFO o hasta reiniciar. Al vencer se vuelve a desenvolver desde
 * Mongo —donde ya no está—, así que la ventana queda acotada al TTL. Hace a que la supresión del
 * art. 16 de la Ley 25.326 se complete, no al rendimiento; si alguna vez se reemplaza, que sea por
 * una invalidación entre nodos, no por nada.
 */
export class UserKeyStore {
	readonly #model: Model<UserKeyDoc>;
	readonly #masterKey: Buffer;
	readonly #cache = new Map<string, { dek: Buffer; expiresAt: number }>();

	constructor(opts: UserKeyStoreOptions) {
		if (opts.masterKey.length !== DEK_LENGTH) throw new Error("masterKey debe ser de 32 bytes");
		this.#masterKey = opts.masterKey;
		this.#model = getOrCreateUserKeyModel(opts.connection, opts.collectionName);
	}

	/** DEK del usuario; la crea (envuelta) si aún no existe. */
	async getUserKey(userId: string): Promise<Buffer> {
		if (!userId) throw new Error("userId requerido para resolver la DEK");
		const cached = this.#cache.get(userId);
		if (cached && cached.expiresAt > Date.now()) return cached.dek;
		// Vencida: descartarla ya, para que el re-cacheo entre a la cola FIFO como entrada nueva.
		if (cached) this.#cache.delete(userId);

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
			// Barrer lo vencido antes de desalojar por FIFO: no tiene sentido tirar una clave viva
			// mientras quedan buffers de claves ya inservibles ocupando lugar.
			this.#dropExpired();
			if (this.#cache.size >= KEY_CACHE_MAX) {
				const oldest = this.#cache.keys().next().value;
				if (oldest !== undefined) this.#cache.delete(oldest);
			}
		}
		this.#cache.set(userId, { dek, expiresAt: Date.now() + KEY_CACHE_TTL_MS });
	}

	/** Barrido perezoso, sin timer: sólo corre cuando la cota obliga a desalojar. */
	#dropExpired(): void {
		const now = Date.now();
		for (const [id, entry] of this.#cache) {
			if (entry.expiresAt <= now) this.#cache.delete(id);
		}
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
