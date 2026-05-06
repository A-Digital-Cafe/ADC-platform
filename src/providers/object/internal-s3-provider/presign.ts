import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PresignDownloadInput, PresignUploadInput, PresignUploadResult } from "./types.js";

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
	});
	const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: ttl });
	const headers: Record<string, string> = {};
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
	const responseContentDisposition = input.filename
		? `${input.inline ? "inline" : "attachment"}; filename="${input.filename.replace(/"/g, "")}"`
		: undefined;
	const cmd = new GetObjectCommand({
		Bucket: bucket,
		Key: input.key,
		ResponseContentDisposition: responseContentDisposition,
	});
	return getSignedUrl(client, cmd, { expiresIn: ttl });
}
