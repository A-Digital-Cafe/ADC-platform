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
	// Los dos topes de CAUDAL, que no son la cuota: la cuota dice cuánto podés tener guardado y
	// éstos a qué ritmo podés llegar a tenerlo. Van con `retryAfterSeconds` en `data`.
	| "ATTACHMENT_TOO_MANY_UPLOADS"
	| "ATTACHMENT_UPLOAD_RATE_EXCEEDED"
	| "ATTACHMENT_ENCRYPTED"
	| "ATTACHMENT_ENCRYPTION_FAILED"
	| "ATTACHMENT_DECRYPT_FAILED"
	| "ATTACHMENT_RANGE_INVALID";

export class AttachmentError extends ADCCustomError<Record<string, unknown>, AttachmentErrorTypes> {
	public readonly name = "AttachmentError";
}
