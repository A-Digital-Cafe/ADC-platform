import { S3Client } from "@aws-sdk/client-s3";
import { isPrivateHost } from "@common/utils/url-utils.js";
import { StorageError } from "@common/types/custom-errors/StorageError.ts";
import { BaseProvider, ProviderType } from "../../BaseProvider.js";
import { ensureBucket } from "./bucket.js";
import { putObject, getObjectStream, headObject, deleteObject } from "./objects.js";
import { getPresignedUploadUrl, getPresignedDownloadUrl } from "./presign.js";

interface SharedS3Entry {
	client: S3Client;
	refCount: number;
}

// El kernel recarga este módulo con cache-busting (?v=timestamp) en cada loadProvider,
// así que cada instancia evalúa el archivo de nuevo. Anclamos los clientes a globalThis
// para que dos providers con la misma config (endpoint+region+credenciales+forcePathStyle)
// reutilicen el mismo S3Client (HTTP keep-alive y conexiones compartidas).
const SHARED_KEY = Symbol.for("adc.s3.sharedClients");
const SHARED_S3_CLIENTS: Map<string, SharedS3Entry> = ((globalThis as any)[SHARED_KEY] ??= new Map<string, SharedS3Entry>());
import type {
	GetObjectStreamInput,
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
	GetObjectStreamInput,
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
	#sharedKey: string | null = null;
	#initialized = false;
	/**
	 * Clientes con los que se **firman** las URLs para el navegador, uno por endpoint. Van
	 * aparte del cliente compartido por dos motivos:
	 *
	 * 1. `requestChecksumCalculation: "WHEN_REQUIRED"`. Con el default (`WHEN_SUPPORTED`) el SDK
	 *    calcula el CRC32 del cuerpo al serializar el PUT, y al presignar el cuerpo está vacío:
	 *    firma `x-amz-checksum-crc32=AAAAAA==` (CRC32 de cero bytes) en la query. Después el
	 *    navegador sube el archivo real, el servidor valida ese checksum contra el cuerpo y
	 *    rechaza el PUT (`XAmzContentChecksumMismatch`). MinIO hoy lo ignora, S3 real no. En las
	 *    llamadas server-side el checksum sí aporta (integridad en tránsito), así que el cliente
	 *    compartido conserva el default.
	 * 2. `publicHost`: hay que firmar contra el host por el que entró el navegador (ver
	 *    `PresignUploadInput`). Sólo aplica en desarrollo con endpoint local.
	 *
	 * Firmar no abre conexiones: estos clientes son objetos de configuración. Se destruyen con
	 * el provider.
	 */
	readonly #presignClients = new Map<string, S3Client>();

	constructor(options?: any) {
		super();
		this.#config = {
			endpoint: options?.endpoint || process.env.S3_ENDPOINT || "http://localhost:3900",
			// Vacío = sin endpoint público diferenciado; ver docstring en `IS3Config`.
			publicEndpoint: options?.publicEndpoint || process.env.S3_PUBLIC_ENDPOINT || "",
			region: options?.region || process.env.S3_REGION || "sa-central-1",
			// Clave de servicio con permisos sólo sobre los buckets de la plataforma, NO una
			// credencial de administración: la firma de cada URL presignada publica este access
			// key, y con una credencial de admin de por medio una fuga del secreto entrega el
			// servidor entero. La provisiona `adc-garage-core/init.sh`.
			//
			// El formato lo impone Garage: id = `GK` + 24 hex, secreto = 32 bytes en hex. Estos
			// defaults son de DESARROLLO y coinciden con los del compose.
			accessKey: options?.accessKey || process.env.S3_ACCESS_KEY || "GKadc000000000000000000000",
			secretKey: options?.secretKey || process.env.S3_SECRET_KEY || "adc0000000000000000000000000000000000000000000000000000000000000",
			forcePathStyle: options?.forcePathStyle ?? true,
			defaultBucket: options?.defaultBucket || process.env.S3_BUCKET || "adc-default",
			presignTtl: options?.presignTtl ?? 900,
		};
	}

	#computeSharedKey(): string {
		// Hash conceptual: dos providers con misma config física comparten cliente.
		// El bucket NO entra: el cliente es agnóstico y cada provider hace ensureBucket
		// del suyo (idempotente).
		return JSON.stringify({
			endpoint: this.#config.endpoint,
			region: this.#config.region,
			accessKey: this.#config.accessKey,
			secretKey: this.#config.secretKey,
			forcePathStyle: this.#config.forcePathStyle,
		});
	}

	#acquireSharedClient(): S3Client {
		const key = this.#computeSharedKey();
		let entry = SHARED_S3_CLIENTS.get(key);
		if (!entry) {
			const client = new S3Client({
				endpoint: this.#config.endpoint,
				region: this.#config.region,
				credentials: { accessKeyId: this.#config.accessKey, secretAccessKey: this.#config.secretKey },
				forcePathStyle: this.#config.forcePathStyle,
			});
			entry = { client, refCount: 0 };
			SHARED_S3_CLIENTS.set(key, entry);
			this.logger?.logOk?.(`[InternalS3Provider] Cliente físico abierto @ ${this.#config.endpoint}`);
		}
		entry.refCount++;
		this.#sharedKey = key;
		return entry.client;
	}

	#releaseSharedClient(): void {
		if (!this.#sharedKey) return;
		const key = this.#sharedKey;
		this.#sharedKey = null;
		const entry = SHARED_S3_CLIENTS.get(key);
		if (!entry) return;
		entry.refCount--;
		if (entry.refCount <= 0) {
			try {
				entry.client.destroy();
			} catch {
				/* ignorar */
			}
			SHARED_S3_CLIENTS.delete(key);
			this.logger?.logOk?.(`[InternalS3Provider] Cliente físico cerrado @ ${this.#config.endpoint}`);
		}
	}

	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		if (this.#initialized) return;
		this.#client = this.#acquireSharedClient();
		try {
			await ensureBucket(this.#client, this.#config.defaultBucket, this.logger);
			this.#initialized = true;
			this.logger.logOk(
				`[InternalS3Provider] Listo @ ${this.#config.endpoint} (bucket=${this.#config.defaultBucket}, refCount compartido)`
			);
		} catch (err: any) {
			this.logger.logError(`[InternalS3Provider] Error inicializando: ${err.message ?? err}`);
		}
	}

	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		this.#releaseSharedClient();
		for (const client of this.#presignClients.values()) {
			try {
				client.destroy();
			} catch {
				/* ignorar */
			}
		}
		this.#presignClients.clear();
		this.#client = null;
		this.#initialized = false;
	}

	#getClient(): S3Client {
		// Tipado y 503, no un `Error` pelado: el provider puede no estar listo todavía (arranque)
		// o ya haberse parado (recarga), y eso es indisponibilidad reintentable, no un bug. Sin
		// tipar, el wrapper HTTP lo saneaba a un 500 `INTERNAL_ERROR` opaco.
		if (!this.#client) throw new StorageError(503, "S3_UNAVAILABLE", "El almacenamiento de objetos no está disponible");
		return this.#client;
	}

	/**
	 * Endpoint contra el que firmar para `publicHost`, o `null` si hay que usar el configurado.
	 * Reescribe sólo entre hosts privados: en producción (S3/CDN real) nunca aplica.
	 */
	#publicEndpointFor(publicHost?: string): string | null {
		if (!publicHost || !isPrivateHost(publicHost)) return null;
		let url: URL;
		try {
			url = new URL(this.#config.endpoint);
		} catch {
			return null;
		}
		if (!isPrivateHost(url.hostname) || url.hostname === publicHost) return null;
		url.hostname = publicHost;
		return url.origin;
	}

	/** Cliente con el que firmar una URL destinada al navegador (ver `#presignClients`). */
	#getPresignClient(publicHost?: string): S3Client {
		// Tipado y 503, no un `Error` pelado: el provider puede no estar listo todavía (arranque)
		// o ya haberse parado (recarga), y eso es indisponibilidad reintentable, no un bug. Sin
		// tipar, el wrapper HTTP lo saneaba a un 500 `INTERNAL_ERROR` opaco.
		if (!this.#client) throw new StorageError(503, "S3_UNAVAILABLE", "El almacenamiento de objetos no está disponible");
		// `publicEndpoint` configurado (gateway/CDN en producción) gana sobre la reescritura por
		// `publicHost`: esa reescritura es una comodidad de dev en LAN y, con un endpoint interno
		// privado detrás del gateway, un `Host` falseado podría elegir contra qué host se firma.
		const endpoint = this.#config.publicEndpoint || this.#publicEndpointFor(publicHost) || this.#config.endpoint;
		let client = this.#presignClients.get(endpoint);
		if (!client) {
			client = new S3Client({
				endpoint,
				region: this.#config.region,
				credentials: { accessKeyId: this.#config.accessKey, secretAccessKey: this.#config.secretKey },
				forcePathStyle: this.#config.forcePathStyle,
				requestChecksumCalculation: "WHEN_REQUIRED",
			});
			this.#presignClients.set(endpoint, client);
			this.logger?.logDebug?.(`[InternalS3Provider] Firmando URLs de navegador @ ${endpoint}`);
		}
		return client;
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
	getObjectStream(input: GetObjectStreamInput): Promise<GetObjectStreamResult> {
		return getObjectStream(this.#getClient(), input, this.#bucket(input.bucket));
	}
	headObject(input: { bucket?: string; key: string }): Promise<HeadObjectResult> {
		return headObject(this.#getClient(), input, this.#bucket(input.bucket));
	}
	deleteObject(input: { bucket?: string; key: string }): Promise<void> {
		return deleteObject(this.#getClient(), input, this.#bucket(input.bucket));
	}
	getPresignedUploadUrl(input: PresignUploadInput): Promise<PresignUploadResult> {
		return getPresignedUploadUrl(this.#getPresignClient(input.publicHost), input, this.#bucket(input.bucket), this.#config.presignTtl);
	}
	getPresignedDownloadUrl(input: PresignDownloadInput): Promise<string> {
		return getPresignedDownloadUrl(this.#getPresignClient(input.publicHost), input, this.#bucket(input.bucket), this.#config.presignTtl);
	}
}
