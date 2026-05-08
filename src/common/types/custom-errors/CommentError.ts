import ADCCustomError from "../ADCCustomError.ts";

type CommentErrorTypes =
	| "COMMENT_FORBIDDEN"
	| "COMMENT_NOT_FOUND"
	| "COMMENT_PARENT_NOT_FOUND"
	| "COMMENT_PARENT_MISMATCH"
	| "COMMENT_DEPTH_EXCEEDED"
	| "COMMENT_EMPTY"
	| "COMMENT_TOO_MANY_ATTACHMENTS"
	| "COMMENT_ATTACHMENTS_DISABLED"
	| "COMMENT_BAD_ATTACHMENT"
	| "COMMENT_ATTACHMENT_NOT_OWNED"
	| "COMMENT_EDIT_WINDOW_CLOSED"
	| "COMMENT_BAD_EMOJI";

export class CommentError extends ADCCustomError<Record<string, unknown>, CommentErrorTypes> {
	public readonly name = "CommentError";
}
