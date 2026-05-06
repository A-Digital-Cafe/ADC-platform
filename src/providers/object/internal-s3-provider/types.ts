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

export interface GetObjectStreamResult {
	stream: Readable;
	contentType?: string;
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
}

export interface PresignUploadResult {
	uploadUrl: string;
	bucket: string;
	key: string;
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
}
