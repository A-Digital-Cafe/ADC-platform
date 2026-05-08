export default {
	common: {
		loading: "Cargando..."
	},
	request: {
		title: "Crear Organización",
		subtitle: "Solicita la creación de una nueva organización",
		form: {
			name: "Nombre de la Organización",
			namePlaceholder: "Ej: Mi Empresa",
			email: "Email de la Organización",
			emailPlaceholder: "info@empresa.com",
			slug: "URL Slug",
			slugPlaceholder: "mi-empresa",
			slugHint: "Solo letras minúsculas, números y guiones",
			autoGenerate: "Auto-generar",
			description: "Descripción",
			descriptionPlaceholder: "Describe tu organización...",
			contactChannels: "Formas de contacto",
			submit: "Solicitar Creación",
			submitting: "Enviando..."
		},
		errors: {
			slugRequired: "Slug es requerido",
			slugInvalid: "Slug inválido",
			submitFailed: "Error al enviar"
		},
		successMessage: "✓ Solicitud enviada correctamente. Redirigiendo...",
		info: "¿Qué sucede después?",
		infoItems: [
			"Tu solicitud será revisada",
			"Recibirás confirmación",
			"Accederás al dashboard"
		]
	},
	home: {
		title: "Mis Organizaciones",
		subtitle: "Gestiona y configura tus organizaciones en ADC Platform",
		empty: {
			title: "No tienes organizaciones",
			description: "Crea tu primera organización para comenzar a colaborar con tu equipo",
			button: "Crear Primera Organización"
		},
		createNew: "Crear Nueva Organización"
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
