import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	DeleteObjectCommand,
	type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import type { GetObjectStreamResult, HeadObjectResult, PutObjectInput, PutObjectResult } from "./types.js";

export async function putObject(client: S3Client, input: PutObjectInput, bucket: string): Promise<PutObjectResult> {
	const cmd: PutObjectCommandInput = {
		Bucket: bucket,
		Key: input.key,
		Body: input.body as any,
		ContentType: input.contentType,
		Metadata: input.metadata,
		ContentLength: input.contentLength,
	};
	const res = await client.send(new PutObjectCommand(cmd));
	return { bucket, key: input.key, etag: res.ETag ?? null };
}

export async function getObjectStream(client: S3Client, input: { key: string }, bucket: string): Promise<GetObjectStreamResult> {
	const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: input.key }));
	return {
		stream: res.Body as Readable,
		contentType: res.ContentType,
		size: res.ContentLength,
		etag: res.ETag ?? undefined,
	};
}

export async function headObject(client: S3Client, input: { key: string }, bucket: string): Promise<HeadObjectResult> {
	const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: input.key }));
	return {
		contentType: res.ContentType,
		size: res.ContentLength,
		etag: res.ETag ?? undefined,
		metadata: res.Metadata,
	};
}

export async function deleteObject(client: S3Client, input: { key: string }, bucket: string): Promise<void> {
	await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: input.key }));
}
