import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PresignDownloadInput, PresignUploadInput, PresignUploadResult } from "./types.js";

/**
 * `Content-Disposition` que queda **guardado en el objeto** en toda subida presignada.
 *
 * Defensa en profundidad para el objeto servido crudo desde el origen S3 (link directo, CDN sin
 * política de headers): un archivo que el cliente declaró `text/html` se descarga en vez de
 * ejecutarse en el origen del bucket. `X-Content-Type-Options: nosniff` no cubre este caso —
 * sólo impide adivinar el tipo, no renderizar el que vino declarado— y encima es una cortesía de
 * MinIO que AWS S3 no manda.
 *
 * No afecta las descargas de la plataforma: `getPresignedDownloadUrl` firma
 * `response-content-disposition`, y ese pisa lo almacenado (por eso las previews siguen inline).
 *
 * Se firma, a diferencia de `Content-Type` (que el presigner de S3 marca explícitamente como
 * unsignable porque browsers y proxies le agregan `; charset=…`): a `Content-Disposition` nadie
 * lo reescribe en el camino.
 */
const UPLOAD_CONTENT_DISPOSITION = "attachment";

export async function getPresignedUploadUrl(
	client: S3Client,
	input: PresignUploadInput,
	bucket: string,
	defaultTtl: number
): Promise<PresignUploadResult> {
	const ttl = input.ttl ?? defaultTtl;
	const cmd = new PutObjectCommand({
		Bucket: bucket,
		Key: input.key,
		ContentType: input.contentType,
		ContentLength: input.contentLength,
		ContentDisposition: UPLOAD_CONTENT_DISPOSITION,
	});
	const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: ttl });
	// El cliente TIENE que mandar estos headers tal cual: `content-disposition` va firmado
	// (entra en `X-Amz-SignedHeaders`), así que omitirlo o cambiarlo da SignatureDoesNotMatch.
	const headers: Record<string, string> = { "Content-Disposition": UPLOAD_CONTENT_DISPOSITION };
	if (input.contentType) headers["Content-Type"] = input.contentType;
	return {
		uploadUrl,
		bucket,
		key: input.key,
		headers,
		expiresIn: ttl,
		expiresAt: new Date(Date.now() + ttl * 1000),
	};
}

export async function getPresignedDownloadUrl(
	client: S3Client,
	input: PresignDownloadInput,
	bucket: string,
	defaultTtl: number
): Promise<string> {
	const ttl = input.ttl ?? defaultTtl;

	let responseContentDisposition = undefined;

	if (input.filename)
		responseContentDisposition = `${input.inline ? "inline" : "attachment"}; filename="${input.filename.replaceAll('"', "")}"`;
	const cmd = new GetObjectCommand({
		Bucket: bucket,
		Key: input.key,
		ResponseContentDisposition: responseContentDisposition,
		ResponseContentType: input.contentType,
	});
	return getSignedUrl(client, cmd, { expiresIn: ttl });
}
