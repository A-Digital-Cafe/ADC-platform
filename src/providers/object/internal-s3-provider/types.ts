import type { Readable } from "node:stream";
import type { Buffer } from "node:buffer";

export interface IS3Config {
	endpoint?: string;
	region?: string;
	accessKey?: string;
	secretKey?: string;
	forcePathStyle?: boolean;
	defaultBucket?: string;
	presignTtl?: number;
}

export interface PutObjectInput {
	bucket?: string;
	key: string;
	body: Buffer | Uint8Array | Readable | string;
	contentType?: string;
	metadata?: Record<string, string>;
	contentLength?: number;
}

export interface PutObjectResult {
	key: string;
	bucket: string;
	etag: string | null;
}

export interface GetObjectStreamInput {
	bucket?: string;
	key: string;
	/** Rango de bytes del objeto, extremos inclusive (`Range: bytes=start-end`). */
	range?: { start: number; end: number };
}

export interface GetObjectStreamResult {
	stream: Readable;
	contentType?: string;
	/** Bytes del cuerpo devuelto: con `range`, el largo del tramo, no del objeto. */
	size?: number;
	etag?: string;
}

export interface HeadObjectResult {
	contentType?: string;
	size?: number;
	etag?: string;
	metadata?: Record<string, string>;
}

export interface PresignUploadInput {
	bucket?: string;
	key: string;
	contentType?: string;
	contentLength?: number;
	ttl?: number;
	/**
	 * Host por el que el navegador llegó a la plataforma (`Host` del request, sin puerto).
	 *
	 * La firma SigV4 incluye el `host`, así que una URL presignada sólo sirve contra el host con
	 * el que se firmó: con un S3 local (`http://localhost:9000`) la URL es inservible desde
	 * cualquier dispositivo que no sea la máquina de desarrollo. Pasando el host del request se
	 * firma contra él (`http://192.168.1.152:9000`) y la subida funciona desde el celular/LAN.
	 *
	 * Sólo se aplica si el endpoint configurado **y** el host recibido son locales/privados; con
	 * un S3 real (producción) se ignora, y así un `Host` falseado no puede desviar la subida.
	 */
	publicHost?: string;
}

export interface PresignUploadResult {
	uploadUrl: string;
	bucket: string;
	key: string;
	/**
	 * Cabeceras que el cliente debe mandar en el PUT **tal cual**: algunas van firmadas
	 * (`Content-Disposition`), así que armarlas a mano rompe la firma con un
	 * `SignatureDoesNotMatch` que no dice por qué.
	 */
	headers: Record<string, string>;
	expiresIn: number;
	expiresAt: Date;
}

export interface PresignDownloadInput {
	bucket?: string;
	key: string;
	ttl?: number;
	filename?: string;
	inline?: boolean;
	/**
	 * `Content-Type` con el que S3 debe responder, pisando el que quedó guardado en el objeto.
	 * Importa porque el `Content-Type` del PUT presignado **no va firmado**: el que subió pudo
	 * declarar uno en la base y guardar otro. Va como `response-content-type`, que sí forma
	 * parte de la firma, así que el cliente no puede sacarlo de la URL.
	 */
	contentType?: string;
	/** Host del request; misma semántica que en `PresignUploadInput`. */
	publicHost?: string;
}
