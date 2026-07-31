import ADCCustomError from "../ADCCustomError.ts";

type AttachmentErrorTypes =
	| "ATTACHMENT_BAD_INPUT"
	| "ATTACHMENT_TOO_LARGE"
	| "ATTACHMENT_UNSUPPORTED_MIME"
	| "ATTACHMENT_FORBIDDEN"
	| "ATTACHMENT_NOT_FOUND"
	| "ATTACHMENT_NOT_UPLOADED"
	| "ATTACHMENT_PENDING"
	| "ATTACHMENT_RETAINED"
	| "ATTACHMENT_QUOTA_EXCEEDED"
	| "ATTACHMENT_ENCRYPTED"
	| "ATTACHMENT_ENCRYPTION_FAILED"
	| "ATTACHMENT_DECRYPT_FAILED"
	| "ATTACHMENT_RANGE_INVALID";

export class AttachmentError extends ADCCustomError<Record<string, unknown>, AttachmentErrorTypes> {
	public readonly name = "AttachmentError";
}
