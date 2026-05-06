import { S3Client } from "@aws-sdk/client-s3";
import { BaseProvider, ProviderType } from "../../BaseProvider.js";
import { ensureBucket } from "./bucket.js";
import { putObject, getObjectStream, headObject, deleteObject } from "./objects.js";
import { getPresignedUploadUrl, getPresignedDownloadUrl } from "./presign.js";
import type {
	GetObjectStreamResult,
	HeadObjectResult,
	IS3Config,
	PresignDownloadInput,
	PresignUploadInput,
	PresignUploadResult,
	PutObjectInput,
	PutObjectResult,
} from "./types.js";

export type {
	GetObjectStreamResult,
	HeadObjectResult,
	PresignDownloadInput,
	PresignUploadInput,
	PresignUploadResult,
	PutObjectInput,
	PutObjectResult,
} from "./types.js";

export default class InternalS3Provider extends BaseProvider {
	public readonly name = "internal-s3-provider";
	public readonly type = ProviderType.OBJECT_PROVIDER;

	readonly #config: Required<IS3Config>;
	#client: S3Client | null = null;
	#initialized = false;

	constructor(options?: any) {
		super();
		this.#config = {
			endpoint: options?.endpoint || process.env.S3_ENDPOINT || "http://localhost:9000",
			region: options?.region || process.env.S3_REGION || "us-east-1",
			accessKey: options?.accessKey || process.env.S3_ACCESS_KEY || "adcadmin",
			secretKey: options?.secretKey || process.env.S3_SECRET_KEY || "adcpassword",
			forcePathStyle: options?.forcePathStyle ?? true,
			defaultBucket: options?.defaultBucket || process.env.S3_BUCKET || "adc-default",
			presignTtl: options?.presignTtl ?? 900,
		};
	}

	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		if (this.#initialized) return;
		this.#client = new S3Client({
			endpoint: this.#config.endpoint,
			region: this.#config.region,
			credentials: { accessKeyId: this.#config.accessKey, secretAccessKey: this.#config.secretKey },
			forcePathStyle: this.#config.forcePathStyle,
		});
		try {
			await ensureBucket(this.#client, this.#config.defaultBucket, this.logger);
			this.#initialized = true;
			this.logger.logOk(`[InternalS3Provider] Listo @ ${this.#config.endpoint} (bucket=${this.#config.defaultBucket})`);
		} catch (err: any) {
			this.logger.logError(`[InternalS3Provider] Error inicializando: ${err.message ?? err}`);
		}
	}

	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		this.#client?.destroy();
		this.#client = null;
		this.#initialized = false;
	}

	#getClient(): S3Client {
		if (!this.#client) throw new Error("InternalS3Provider no inicializado");
		return this.#client;
	}

	#bucket(b?: string): string {
		return b ?? this.#config.defaultBucket;
	}

	getDefaultBucket(): string {
		return this.#config.defaultBucket;
	}
	getDefaultPresignTtl(): number {
		return this.#config.presignTtl;
	}

	putObject(input: PutObjectInput): Promise<PutObjectResult> {
		return putObject(this.#getClient(), input, this.#bucket(input.bucket));
	}
	getObjectStream(input: { bucket?: string; key: string }): Promise<GetObjectStreamResult> {
		return getObjectStream(this.#getClient(), input, this.#bucket(input.bucket));
	}
	headObject(input: { bucket?: string; key: string }): Promise<HeadObjectResult> {
		return headObject(this.#getClient(), input, this.#bucket(input.bucket));
	}
	deleteObject(input: { bucket?: string; key: string }): Promise<void> {
		return deleteObject(this.#getClient(), input, this.#bucket(input.bucket));
	}
	getPresignedUploadUrl(input: PresignUploadInput): Promise<PresignUploadResult> {
		return getPresignedUploadUrl(this.#getClient(), input, this.#bucket(input.bucket), this.#config.presignTtl);
	}
	getPresignedDownloadUrl(input: PresignDownloadInput): Promise<string> {
		return getPresignedDownloadUrl(this.#getClient(), input, this.#bucket(input.bucket), this.#config.presignTtl);
	}
}
