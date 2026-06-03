import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

interface Logger {
	logOk: (m: string) => void;
	logWarn: (m: string) => void;
}

/**
 * Verifica que un bucket exista; lo crea si no. Tolera condiciones de carrera
 * (BucketAlreadyOwnedByYou / BucketAlreadyExists).
 *
 * Nota: HeadBucket es una petición HTTP HEAD sin cuerpo, por lo que MinIO/S3
 * no devuelven el código XML de error y el SDK reporta `UnknownError` o el
 * status como nombre. Por eso, ante cualquier fallo de verificación intentamos
 * crear el bucket (operación idempotente): si ya existe, MinIO responde con
 * BucketAlreadyOwnedByYou/BucketAlreadyExists y lo damos por bueno.
 */
export async function ensureBucket(client: S3Client, bucket: string, logger: Logger): Promise<void> {
	try {
		await client.send(new HeadBucketCommand({ Bucket: bucket }));
		return;
	} catch {
		// Cualquier error (404, 403, UnknownError, redirect, MinIO arrancando...)
		// se resuelve intentando crear el bucket de forma idempotente.
	}

	try {
		await client.send(new CreateBucketCommand({ Bucket: bucket }));
		logger.logOk(`[InternalS3Provider] Bucket creado: ${bucket}`);
	} catch (createErr: any) {
		if (createErr?.name === "BucketAlreadyOwnedByYou" || createErr?.name === "BucketAlreadyExists") {
			return; // Ya existía: condición de carrera esperada, sin problema.
		}
		logger.logWarn(`[InternalS3Provider] No se pudo verificar/crear bucket ${bucket}: ${createErr?.message ?? createErr}`);
	}
}
