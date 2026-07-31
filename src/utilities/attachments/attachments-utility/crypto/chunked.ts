import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado por chunks para lectura parcial (seek): AES-256-GCM por bloque.
 *
 * El GCM "entero" (`aes-256-gcm`) obliga a descifrar desde el byte 0: no hay
 * forma de servir un `Range` sin materializar el objeto completo. Acá el objeto
 * se parte en chunks de tamaño fijo EN CLARO y cada chunk se cifra por separado:
 *
 *   S3: [c₀ ‖ tag₀][c₁ ‖ tag₁] … [cₙ ‖ tagₙ]      (tag GCM de 16 bytes por chunk)
 *
 * IV por chunk = prefijo aleatorio de 8 bytes (por objeto) ‖ contador BE de
 * 4 bytes (índice del chunk). El contador dentro del IV hace dos cosas: nunca se
 * repite IV bajo la misma DEK dentro del objeto, y **ata cada chunk a su
 * posición** — un ciphertext movido de lugar se descifra con el IV de otra
 * posición y su auth tag no verifica (reordenar o duplicar chunks rompe).
 *
 * Para servir `bytes=a-b` alcanza con pedirle a S3 el rango del ciphertext que
 * cubre [a, b] (`chunkedCipherRange`), descifrar esos chunks y recortar los
 * extremos (`decryptChunkedRange`): memoria acotada a un chunk, tag verificado
 * antes de emitir cada parte.
 */

export const CHUNKED_ENCRYPTION_SCHEME = "aes-256-gcm-chunked" as const;
/** 1 MiB en claro por chunk: un seek sobre-lee a lo sumo ~1 MiB y el overhead de tags es 16 B/MiB. */
export const ENCRYPTION_CHUNK_SIZE = 1024 * 1024;

const ALGORITHM = "aes-256-gcm";
const GCM_TAG_LENGTH = 16;
const IV_PREFIX_LENGTH = 8;

/** Tramo del recurso en claro, extremos inclusive. */
export interface PlainByteRange {
	start: number;
	end: number;
}

function chunkIv(prefix: Buffer, index: number): Buffer {
	const iv = Buffer.allocUnsafe(IV_PREFIX_LENGTH + 4);
	prefix.copy(iv, 0);
	iv.writeUInt32BE(index, IV_PREFIX_LENGTH);
	return iv;
}

/** Largo del frame (ciphertext + tag) del chunk `index` de un objeto de `plainSize` bytes en claro. */
function frameLength(index: number, plainSize: number, chunkSize: number): number {
	return Math.min(chunkSize, plainSize - index * chunkSize) + GCM_TAG_LENGTH;
}

/**
 * Cifra el objeto entero, bufferizado: los tags de GCM sólo son válidos tras `final()` (por
 * streaming contra el SDK de S3 es una carrera) y el tamaño lo acota el límite de subida.
 */
export function encryptChunked(dek: Buffer, plaintext: Buffer, chunkSize = ENCRYPTION_CHUNK_SIZE): { ivPrefix: Buffer; ciphertext: Buffer } {
	const ivPrefix = randomBytes(IV_PREFIX_LENGTH);
	const parts: Buffer[] = [];
	for (let index = 0, offset = 0; offset < plaintext.length || index === 0; index++, offset += chunkSize) {
		const cipher = createCipheriv(ALGORITHM, dek, chunkIv(ivPrefix, index));
		parts.push(cipher.update(plaintext.subarray(offset, offset + chunkSize)), cipher.final(), cipher.getAuthTag());
	}
	return { ivPrefix, ciphertext: Buffer.concat(parts) };
}

/**
 * Rango de bytes DEL CIPHERTEXT que cubre un tramo del claro: los chunks que
 * contienen a `range`, enteros (con sus tags). Es lo que hay que pedirle a S3
 * para poder alimentar `decryptChunkedRange` con ese mismo `range`.
 */
export function chunkedCipherRange(range: PlainByteRange, plainSize: number, chunkSize: number): { start: number; end: number } {
	const cipherSize = plainSize + GCM_TAG_LENGTH * Math.ceil(plainSize / chunkSize);
	const frame = chunkSize + GCM_TAG_LENGTH;
	const firstChunk = Math.floor(range.start / chunkSize);
	const lastChunk = Math.floor(range.end / chunkSize);
	return { start: firstChunk * frame, end: Math.min((lastChunk + 1) * frame, cipherSize) - 1 };
}

/**
 * Descifra el tramo `range` del claro a partir del stream del ciphertext de los
 * chunks que lo cubren (exactamente lo que devuelve `chunkedCipherRange`; el
 * stream puede venir en pedazos de cualquier tamaño). Verifica el auth tag de
 * cada chunk antes de emitir su parte; lanza si el ciphertext viene truncado.
 */
export async function* decryptChunkedRange(
	dek: Buffer,
	ivPrefixB64: string,
	opts: { plainSize: number; chunkSize: number; range: PlainByteRange },
	source: AsyncIterable<Uint8Array>
): AsyncGenerator<Buffer> {
	const ivPrefix = Buffer.from(ivPrefixB64, "base64");
	if (ivPrefix.length !== IV_PREFIX_LENGTH) throw new Error("Prefijo de IV inválido para cifrado por chunks");
	const { plainSize, chunkSize, range } = opts;
	const lastChunk = Math.floor(range.end / chunkSize);

	let index = Math.floor(range.start / chunkSize);
	let pending: Buffer[] = [];
	let pendingLength = 0;

	for await (const piece of source) {
		let data = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
		while (data.length > 0) {
			const needed = frameLength(index, plainSize, chunkSize) - pendingLength;
			const taken = data.subarray(0, needed);
			pending.push(taken);
			pendingLength += taken.length;
			data = data.subarray(taken.length);
			if (pendingLength < frameLength(index, plainSize, chunkSize)) continue;

			yield decryptFrame(dek, ivPrefix, index, Buffer.concat(pending), chunkSize, range);
			pending = [];
			pendingLength = 0;
			index++;
			// El rango pedido ya salió completo: lo que quede en el stream no es de este rango.
			if (index > lastChunk) return;
		}
	}
	if (index <= lastChunk) throw new Error(`Ciphertext truncado: faltan chunks (${index}..${lastChunk})`);
}

/** Descifra un frame completo (verificando su tag) y recorta la parte que cae dentro del rango pedido. */
function decryptFrame(dek: Buffer, ivPrefix: Buffer, index: number, frame: Buffer, chunkSize: number, range: PlainByteRange): Buffer {
	const decipher = createDecipheriv(ALGORITHM, dek, chunkIv(ivPrefix, index));
	decipher.setAuthTag(frame.subarray(frame.length - GCM_TAG_LENGTH));
	const plain = Buffer.concat([decipher.update(frame.subarray(0, frame.length - GCM_TAG_LENGTH)), decipher.final()]);
	const chunkStart = index * chunkSize;
	const from = Math.max(range.start - chunkStart, 0);
	const to = Math.min(range.end - chunkStart, plain.length - 1);
	return plain.subarray(from, to + 1);
}
