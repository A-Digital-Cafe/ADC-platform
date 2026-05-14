export default {
	common: {
		loading: "Cargando...",
		sending: "Enviando..."
	},
	request: {
		title: "Solicitar Nueva Organización",
		subtitle: "Completa el formulario para solicitar la creación de una nueva organización",
		form: {
			name: "Nombre de la Organización",
			namePlaceholder: "Ej: Mi Empresa",
			email: "Email de Contacto",
			emailPlaceholder: "contacto@empresa.com",
			description: "Descripción",
			descriptionPlaceholder: "Describe tu organización y sus objetivos...",
			contactChannels: "Redes Sociales (Opcional)",
			submit: "Enviar Solicitud",
			submitting: "Enviando...",
			cancel: "Cancelar"
		},
		errors: {
			nameRequired: "Por favor ingresa el nombre de la organización",
			nameMinLength: "El nombre debe tener al menos 3 caracteres",
			emailRequired: "Por favor ingresa tu email",
			emailInvalid: "Por favor ingresa un email válido",
			descriptionTooLong: "La descripción no puede superar los 2000 caracteres",
			urlInvalid: "Por favor ingresa una URL válida (ej: https://tu-org.com)",
			socialNetworkInvalid: "Cada red social debe tener nombre y URL",
			socialNetworkUrlInvalid: "Las URLs de redes sociales deben ser válidas",
			submitError: "Error al enviar la solicitud"
		},
		info: "Tu solicitud será revisada por un administrador. Una vez aprobada, podrás acceder a tu organización e invitar miembros.",
		successTitle: "¡Solicitud enviada!",
		successMessage: "Tu solicitud de organización ha sido registrada y está pendiente de revisión por parte del equipo administrativo.",
		successWhat: "¿Qué sucede ahora?",
		successItems: [
			"El equipo de administración revisará tu solicitud.",
			"Recibirás un email cuando tu solicitud sea aprobada o si se necesita más información."
		],
		goHome: "Ir al Inicio"
	},
	home: {
		title: "Mis Organizaciones",
		subtitle: "Gestiona y configura tus organizaciones en ADC Platform",
		requestNew: "Solicitar Nueva Organización",
		requestNewDescription: "Completa el formulario para que un administrador pueda revisar tu solicitud",
		myOrganizations: "Mis Organizaciones",
		submitInfo: "Tu solicitud será revisada por un administrador. Una vez aprobada, podrás acceder a tu organización e invitar miembros.",
		submitButton: "Enviar Solicitud",
		requestSuccess: "Solicitud enviada. Un administrador la revisará pronto.",
		empty: {
			title: "No tienes organizaciones",
			description: "Solicita la creación de una nueva organización para comenzar a colaborar con tu equipo",
			button: "Solicitar Primera Organización"
		}
	},
	dashboard: {
		loading: "Cargando...",
		notFound: "Organización no encontrada",
		back: "Volver"
	},
	tabs: {
		general: "General",
		apps: "Aplicaciones",
		admin: "Administración"
	},
	general: {
		title: "Información General",
		editButton: "Editar",
		successMessage: "Cambios guardados",
		errorMessage: "Error al guardar",
		form: {
			name: "Nombre",
			email: "Email",
			slug: "Slug",
			description: "Descripción",
			tier: "Plan",
			status: "Estado",
			save: "Guardar",
			saving: "Guardando...",
			cancel: "Cancelar"
		}
	},
	apps: {
		title: "Aplicaciones",
		subtitle: "Gestiona qué aplicaciones están disponibles",
		loading: "Cargando aplicaciones...",
		note: "Los cambios se guardan automáticamente"
	},
	admin: {
		title: "Administración",
		subtitle: "Funciones administrativas avanzadas",
		upgrade: {
			title: "Actualizar Plan",
			description: "Solicita un upgrade de plan",
			feature1: "Mayor capacidad",
			feature2: "Más usuarios",
			feature3: "Soporte prioritario",
			button: "Solicitar Upgrade",
			sending: "Enviando...",
			successMessage: "✓ Solicitud creada (ID: {{ticketId}})",
			errorMessage: "Error al crear solicitud"
		},
		danger: {
			title: "Zona de Peligro"
		},
		delete: {
			description: "Solicitar eliminación de la organización",
			button: "Solicitar Eliminación",
			confirmMessage: "¿Eliminar {{name}}?",
			confirmHint: "Esta acción no es reversible",
			confirmButton: "Confirmar",
			confirming: "Creando...",
			cancel: "Cancelar",
			successMessage: "✓ Solicitud de eliminación creada",
			errorMessage: "Error al crear solicitud"
		},
		info: "Todas las acciones crean tickets para revisión"
	}
};
