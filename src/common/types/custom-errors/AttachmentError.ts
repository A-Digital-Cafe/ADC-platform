import ADCCustomError from "../ADCCustomError.ts";

type AttachmentErrorTypes =
	| "ATTACHMENT_BAD_INPUT"
	| "ATTACHMENT_TOO_LARGE"
	| "ATTACHMENT_UNSUPPORTED_MIME"
	| "ATTACHMENT_FORBIDDEN"
	| "ATTACHMENT_NOT_FOUND"
	| "ATTACHMENT_NOT_UPLOADED"
	| "ATTACHMENT_PENDING";

export class AttachmentError extends ADCCustomError<Record<string, unknown>, AttachmentErrorTypes> {
	public readonly name = "AttachmentError";
}
