import ADCCustomError from "../ADCCustomError.ts";

type AttachmentErrorTypes =
	| "ATTACHMENT_BAD_INPUT"
	| "ATTACHMENT_TOO_LARGE"
	| "ATTACHMENT_UNSUPPORTED_MIME"
	| "ATTACHMENT_FORBIDDEN"
	| "ATTACHMENT_NOT_FOUND"
	| "ATTACHMENT_NOT_UPLOADED"
	| "ATTACHMENT_PENDING"
	| "ATTACHMENT_QUOTA_EXCEEDED"
	| "ATTACHMENT_ENCRYPTED"
	| "ATTACHMENT_ENCRYPTION_FAILED"
	| "ATTACHMENT_DECRYPT_FAILED";

export class AttachmentError extends ADCCustomError<Record<string, unknown>, AttachmentErrorTypes> {
	public readonly name = "AttachmentError";
}
