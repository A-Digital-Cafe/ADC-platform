export default {
	common: {
		loading: "Loading..."
	},
	request: {
		title: "Create Organization",
		subtitle: "Request the creation of a new organization",
		form: {
			name: "Organization Name",
			namePlaceholder: "Ex: My Company",
			email: "Organization Email",
			emailPlaceholder: "info@company.com",
			slug: "URL Slug",
			slugPlaceholder: "my-company",
			slugHint: "Only lowercase letters, numbers and hyphens",
			autoGenerate: "Auto-generate",
			description: "Description",
			descriptionPlaceholder: "Describe your organization...",
			contactChannels: "Contact Methods",
			submit: "Request Creation",
			submitting: "Submitting..."
		},
		errors: {
			slugRequired: "Slug is required",
			slugInvalid: "Invalid slug",
			submitFailed: "Error submitting"
		},
		successMessage: "✓ Request sent successfully. Redirecting...",
		info: "What happens next?",
		infoItems: [
			"Your request will be reviewed",
			"You'll receive confirmation",
			"You'll access the dashboard"
		]
	},
	home: {
		title: "My Organizations",
		subtitle: "Manage and configure your organizations in ADC Platform",
		empty: {
			title: "You have no organizations",
			description: "Create your first organization to start collaborating with your team",
			button: "Create First Organization"
		},
		createNew: "Create New Organization"
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
