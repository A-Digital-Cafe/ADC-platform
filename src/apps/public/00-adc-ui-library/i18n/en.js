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
		// Emitted by the HTTP client itself when an endpoint's rate limit is hit.
		RATE_LIMIT_EXCEEDED: "Too many requests in a row. Please wait a moment before trying again.",
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
		// Plan checkout errors. Request-specific ones (SEATS_OUT_OF_RANGE,
		// PLAN_NOT_PURCHASABLE) are deliberately left untranslated: the server message
		// carries the concrete detail ("starts at 4 seats") that a static string loses.
		CHECKOUT_FAILED: "Checkout could not be started. Please try again in a few minutes.",
		GATEWAY_UNAVAILABLE: "No payment gateway is available right now.",
		GATEWAY_ERROR: "The payment gateway did not respond. Please try again in a few minutes.",
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
		COMMENT_BAD_EMOJI: "Invalid emoji",
		// Drive errors: plan caps and allowances. They live here rather than in the app's
		// i18n because `adc-custom-error` (the global toast in `adc-layout`) resolves
		// `errors.<key>` against this dictionary, same as attachments and gateways.
		FILE_TOO_LARGE: "This file is larger than your plan's maximum file size.",
		STORAGE_FULL: "Storage quota is full. Free up space or move to a larger plan.",
		EGRESS_QUOTA_EXCEEDED: "You've reached your plan's monthly download allowance. It resets at the start of the month.",
		TUNNEL_QUOTA_EXCEEDED: "You've reached your monthly device-transfer allowance. It resets at the start of the month.",
		DEVICE_LIMIT: "You've reached your plan's linked-device limit. Unlink one to add another.",
		REMOTE_UNIT_LIMIT: "You've reached your plan's remote-unit limit.",
		TRANSFER_LIMIT: "You already have as many transfers running as your plan allows. Wait for one to finish.",
		ARCHIVE_EXPIRED: "That zip download expired. Generate it again from your selection.",
		ARCHIVE_NOT_FOUND: "That zip download doesn't exist.",
		LINK_UNAVAILABLE: "This link isn't available right now. Try again later."
	},
	footer: {
		aria: "Help links",
		privacy: "Privacy",
		terms: "Terms",
		cookies: "Cookies",
		contact: "Contact",
		team: "Team",
		help: "Help",
		status: "Status"
	},
	platformLink: {
		denied: "No access",
		app: {
			home: "Abby's Digital Cafe",
			auth: "Auth",
			community: "Community",
			projects: "Projects",
			identity: "Identity",
			drive: "Drive",
			editor: "Image Editor",
			mail: "Mail",
			help: "Help",
			"my-account": "My Account",
			org: "Organizations",
			status: "Status"
		}
	}
};
