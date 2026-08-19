export default {
	banned: {
		title: "Access blocked",
		subtitle: "Your access to the platform has been restricted.",
		defaultReason: "The account or IP was flagged by moderation.",
		hint: "If you think this is a mistake, contact support.",
	},
	csrf: {
		title: "Security error",
		subtitle: "State validation failed.",
		description: "We detected a possible CSRF attempt during authentication. For your safety, the flow was interrupted.",
		hint: "Start the sign-in process again from the beginning.",
	},
	oauth: {
		title: "External authentication error",
		subtitle: "We couldn't complete the sign-in.",
		subtitleProvider: "We couldn't complete sign-in with {{provider}}.",
		defaultMessage: "Something went wrong while authenticating with the provider.",
		hint: "Try again or use a different method.",
	},
	unauthorized: {
		title: "Restricted access",
		subtitle: "This section is not available for your account.",
		subtitleApp: "\u201C{{app}}\u201D is not available for your account.",
		auth: "You need to sign in to access this section.",
		role: "Your account doesn't have a role enabled for this section.",
		org: "This section manages the platform, not an organization: switch to your personal account to continue.",
		unavailable: "The accounts system is unavailable right now, so we can't verify your access.",
		login: "Sign in",
		hint: "If you think you should have access, ask a platform administrator.",
	},
	generic: {
		title: "Something went wrong",
		subtitle: "An unexpected error occurred.",
		defaultMessage: "We couldn't process your request.",
		hint: "Please try again later.",
	},
};
