export default {
	common: {
		loading: "Loading...",
		sending: "Sending..."
	},
	request: {
		title: "Request New Organization",
		subtitle: "Complete the form to request the creation of a new organization",
		form: {
			name: "Organization Name",
			namePlaceholder: "Ex: My Company",
			email: "Contact Email",
			emailPlaceholder: "contact@company.com",
			description: "Description",
			descriptionPlaceholder: "Describe your organization and its goals...",
			contactChannels: "Social Networks (Optional)",
			submit: "Submit Request",
			submitting: "Submitting...",
			cancel: "Cancel"
		},
		errors: {
			nameRequired: "Please enter the organization name",
			nameMinLength: "The name must be at least 3 characters long",
			emailRequired: "Please enter your email",
			emailInvalid: "Please enter a valid email",
			urlInvalid: "Please enter a valid URL (ex: https://your-org.com)",
			submitError: "Error submitting the request"
		},
		info: "Your request will be reviewed by an administrator. Once approved, you'll be able to access your organization and invite members.",
		successTitle: "Request sent!",
		successMessage: "Your organization request has been recorded and is pending review by the administrative team.",
		successWhat: "What happens next?",
		successItems: [
			"The administration team will review your request.",
			"You'll receive an email when your request is approved or if we need more information."
		],
		goHome: "Go to Home"
	},
	home: {
		title: "My Organizations",
		subtitle: "Manage and configure your organizations in ADC Platform",
		requestNew: "Request New Organization",
		requestNewDescription: "Complete the form so an administrator can review your request",
		myOrganizations: "My Organizations",
		submitInfo: "Your request will be reviewed by an administrator. Once approved, you'll be able to access your organization and invite members.",
		submitButton: "Submit Request",
		requestSuccess: "Request sent. An administrator will review it soon.",
		empty: {
			title: "You have no organizations",
			description: "Request the creation of a new organization to start collaborating with your team",
			button: "Request First Organization"
		}
	},
	dashboard: {
		loading: "Loading...",
		notFound: "Organization not found",
		back: "Back"
	},
	tabs: {
		general: "General",
		apps: "Applications",
		admin: "Administration"
	},
	general: {
		title: "General Information",
		editButton: "Edit",
		successMessage: "Changes saved",
		errorMessage: "Error saving",
		form: {
			name: "Name",
			email: "Email",
			slug: "Slug",
			description: "Description",
			tier: "Plan",
			status: "Status",
			save: "Save",
			saving: "Saving...",
			cancel: "Cancel"
		}
	},
	apps: {
		title: "Applications",
		subtitle: "Manage which applications are available",
		loading: "Loading applications...",
		note: "Changes are saved automatically"
	},
	admin: {
		title: "Administration",
		subtitle: "Advanced administrative functions",
		upgrade: {
			title: "Upgrade Plan",
			description: "Request a plan upgrade",
			feature1: "More capacity",
			feature2: "More users",
			feature3: "Priority support",
			button: "Request Upgrade",
			sending: "Sending...",
			successMessage: "✓ Request created (ID: {{ticketId}})",
			errorMessage: "Error creating request"
		},
		danger: {
			title: "Danger Zone"
		},
		delete: {
			description: "Request organization deletion",
			button: "Request Deletion",
			confirmMessage: "Delete {{name}}?",
			confirmHint: "This action cannot be reversed",
			confirmButton: "Confirm",
			confirming: "Creating...",
			cancel: "Cancel",
			successMessage: "✓ Deletion request created",
			errorMessage: "Error creating request"
		},
		info: "All actions create tickets for review"
	}
};
