export default {
	errors: {
		// Generic HTTP errors
		http: {
			400: "Bad request",
			401: "Authentication required",
			403: "Access denied",
			404: "Resource not found",
			409: "Conflict with current state",
			500: "Internal server error",
			503: "Service unavailable"
		},
		// Global errors (not domain-specific)
		FORBIDDEN: "Access denied",
		UNAUTHORIZED: "Unauthorized",
		INVALID_BODY: "Invalid request body",
		USER_NOT_FOUND: "User not found",
		UNHANDLED_ERROR: "An unexpected error occurred",
		UNKNOWN_ERROR: "Unknown error",
		CONNECTION_REFUSED: "Could not connect to the server. Please check your connection or try again later.",
		// Generic session/auth errors (authGenericErrors)
		NO_SESSION: "No active session",
		INVALID_SESSION: "Invalid session",
		NO_REFRESH_TOKEN: "No refresh token",
		INVALID_REFRESH_TOKEN: "Invalid refresh token",
		LOCATION_CHANGE: "Session invalidated due to location change",
		REFRESH_FAILED: "Error refreshing tokens",
		// Idempotency errors
		IDEMPOTENCY_RUNNING: "This operation is already being processed. Please wait up to 2 minutes before trying again.",
		IDEMPOTENCY_KEY_MISSING: "An idempotency key is required for this operation.",
		// Attachment errors
		ATTACHMENT_BAD_INPUT: "Invalid attachment data",
		ATTACHMENT_TOO_LARGE: "The file exceeds the maximum allowed size",
		ATTACHMENT_UNSUPPORTED_MIME: "Unsupported file type",
		ATTACHMENT_FORBIDDEN: "You are not allowed to perform this action on this attachment",
		ATTACHMENT_NOT_FOUND: "Attachment not found",
		ATTACHMENT_NOT_UPLOADED: "The attachment has not been uploaded yet",
		ATTACHMENT_PENDING: "The attachment is still pending confirmation",
		// Comment errors
		COMMENT_FORBIDDEN: "You are not allowed to perform this action on this comment",
		COMMENT_NOT_FOUND: "Comment not found",
		COMMENT_PARENT_NOT_FOUND: "Parent comment not found",
		COMMENT_PARENT_MISMATCH: "The parent comment belongs to a different resource",
		COMMENT_DEPTH_EXCEEDED: "Maximum thread depth exceeded",
		COMMENT_EMPTY: "The comment cannot be empty",
		COMMENT_TOO_MANY_ATTACHMENTS: "Too many attachments in this comment",
		COMMENT_ATTACHMENTS_DISABLED: "Attachments are not enabled for comments here",
		COMMENT_BAD_ATTACHMENT: "Invalid or unauthorized attachment",
		COMMENT_ATTACHMENT_NOT_OWNED: "You can only attach files you uploaded",
		COMMENT_EDIT_WINDOW_CLOSED: "This comment can no longer be edited",
		COMMENT_BAD_EMOJI: "Invalid emoji"
	}
};
