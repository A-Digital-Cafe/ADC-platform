import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

interface Logger {
	logOk: (m: string) => void;
	logWarn: (m: string) => void;
}

/**
 * Verifica que un bucket exista; lo crea si no. Tolera condiciones de carrera
 * (BucketAlreadyOwnedByYou / BucketAlreadyExists).
 */
export async function ensureBucket(client: S3Client, bucket: string, logger: Logger): Promise<void> {
	try {
		await client.send(new HeadBucketCommand({ Bucket: bucket }));
	} catch (err: any) {
		const status = err?.$metadata?.httpStatusCode;
		const isMissing = status === 404 || err?.name === "NotFound" || err?.name === "NoSuchBucket";
		if (!isMissing) {
			logger.logWarn(`[InternalS3Provider] No se pudo verificar bucket ${bucket}: ${err.message ?? err}`);
			return;
		}
		try {
			await client.send(new CreateBucketCommand({ Bucket: bucket }));
			logger.logOk(`[InternalS3Provider] Bucket creado: ${bucket}`);
		} catch (createErr: any) {
			if (createErr?.name !== "BucketAlreadyOwnedByYou" && createErr?.name !== "BucketAlreadyExists") {
				throw createErr;
			}
		}
	}
}
