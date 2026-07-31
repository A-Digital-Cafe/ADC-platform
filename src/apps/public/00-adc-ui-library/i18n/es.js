export default {
	errors: {
		// Errores HTTP genéricos
		http: {
			400: "Solicitud incorrecta",
			401: "Autenticación requerida",
			403: "Acceso denegado",
			404: "Recurso no encontrado",
			409: "Conflicto con el estado actual",
			500: "Error interno del servidor",
			503: "Servicio no disponible"
		},
		// Errores globales (no específicos de dominio)
		FORBIDDEN: "Acceso denegado",
		UNAUTHORIZED: "No autorizado",
		INVALID_BODY: "Cuerpo de solicitud inválido",
		USER_NOT_FOUND: "Usuario no encontrado",
		UNHANDLED_ERROR: "Ha ocurrido un error inesperado",
		UNKNOWN_ERROR: "Error desconocido",
		CONNECTION_REFUSED: "No se pudo conectar con el servidor. Verifica tu conexión o inténtalo más tarde.",
		// La emite el propio cliente HTTP al agotarse el límite del endpoint.
		RATE_LIMIT_EXCEEDED: "Demasiadas solicitudes seguidas. Espera un momento antes de volver a intentar.",
		// Errores genéricos de sesión/auth (authGenericErrors)
		NO_SESSION: "No hay sesión activa",
		INVALID_SESSION: "Sesión inválida",
		NO_REFRESH_TOKEN: "No hay token de refresco",
		INVALID_REFRESH_TOKEN: "Token de refresco inválido",
		LOCATION_CHANGE: "Sesión invalidada por cambio de ubicación",
		REFRESH_FAILED: "Error al refrescar tokens",
		// Errores de idempotencia
		IDEMPOTENCY_RUNNING: "Esta operación ya está siendo procesada. Espere hasta 2 minutos antes de intentar nuevamente.",
		IDEMPOTENCY_KEY_MISSING: "Se requiere una clave de idempotencia para esta operación.",
		// Errores de contratación de planes. Los específicos del pedido
		// (SEATS_OUT_OF_RANGE, PLAN_NOT_PURCHASABLE) NO se traducen a propósito: su
		// mensaje del servidor lleva el dato concreto ("arranca en 4 asientos") y una
		// traducción estática lo perdería.
		CHECKOUT_FAILED: "No se pudo iniciar la contratación. Inténtalo de nuevo en unos minutos.",
		GATEWAY_UNAVAILABLE: "No hay ninguna pasarela de pago disponible en este momento.",
		GATEWAY_ERROR: "La pasarela de pago no respondió. Inténtalo de nuevo en unos minutos.",
		// Errores de adjuntos
		ATTACHMENT_BAD_INPUT: "Datos de adjunto inválidos",
		ATTACHMENT_TOO_LARGE: "El archivo supera el tamaño máximo permitido",
		ATTACHMENT_UNSUPPORTED_MIME: "Tipo de archivo no soportado",
		ATTACHMENT_FORBIDDEN: "No tienes permiso para realizar esta acción sobre este adjunto",
		ATTACHMENT_NOT_FOUND: "Adjunto no encontrado",
		ATTACHMENT_NOT_UPLOADED: "El adjunto aún no ha sido subido",
		ATTACHMENT_PENDING: "El adjunto está pendiente de confirmación",
		// Errores de comentarios
		COMMENT_FORBIDDEN: "No tienes permiso para realizar esta acción sobre este comentario",
		COMMENT_NOT_FOUND: "Comentario no encontrado",
		COMMENT_PARENT_NOT_FOUND: "Comentario padre no encontrado",
		COMMENT_PARENT_MISMATCH: "El comentario padre pertenece a otro recurso",
		COMMENT_DEPTH_EXCEEDED: "Se ha excedido la profundidad máxima del hilo",
		COMMENT_EMPTY: "El comentario no puede estar vacío",
		COMMENT_TOO_MANY_ATTACHMENTS: "Demasiados adjuntos en este comentario",
		COMMENT_ATTACHMENTS_DISABLED: "Los adjuntos no están habilitados para comentarios aquí",
		COMMENT_BAD_ATTACHMENT: "Adjunto inválido o no autorizado",
		COMMENT_ATTACHMENT_NOT_OWNED: "Solo puedes adjuntar archivos que tú hayas subido",
		COMMENT_EDIT_WINDOW_CLOSED: "Ya no se puede editar este comentario",
		COMMENT_BAD_EMOJI: "Emoji inválido",
		// Errores de Drive: topes y cupos del plan. Van acá y no en el i18n de la app
		// porque `adc-custom-error` (el toast global de `adc-layout`) resuelve por
		// `errors.<clave>` contra este diccionario, igual que los de adjuntos y pasarela.
		FILE_TOO_LARGE: "El archivo supera el tamaño máximo que permite tu plan.",
		STORAGE_FULL: "Cuota de almacenamiento agotada. Liberá espacio o pasá a un plan con más lugar.",
		EGRESS_QUOTA_EXCEEDED: "Alcanzaste el cupo de descarga mensual de tu plan. Se renueva al empezar el mes.",
		TUNNEL_QUOTA_EXCEEDED: "Alcanzaste el cupo mensual de transferencia entre dispositivos. Se renueva al empezar el mes.",
		DEVICE_LIMIT: "Llegaste al máximo de dispositivos vinculados de tu plan. Desvinculá uno para agregar otro.",
		REMOTE_UNIT_LIMIT: "Llegaste al máximo de unidades remotas de tu plan.",
		TRANSFER_LIMIT: "Ya tenés en curso todas las transferencias simultáneas que permite tu plan. Esperá a que termine una.",
		ARCHIVE_EXPIRED: "Esa descarga comprimida expiró. Volvé a generarla desde la selección.",
		ARCHIVE_NOT_FOUND: "Esa descarga comprimida no existe.",
		LINK_UNAVAILABLE: "El enlace no está disponible en este momento. Probá más tarde."
	},
	footer: {
		aria: "Enlaces de ayuda",
		privacy: "Privacidad",
		terms: "Términos",
		cookies: "Cookies",
		contact: "Contacto",
		team: "Equipo",
		help: "Ayuda",
		status: "Estado"
	},
	platformLink: {
		denied: "Sin acceso",
		app: {
			home: "Abby's Digital Cafe",
			auth: "Auth",
			community: "Comunidad",
			projects: "Proyectos",
			identity: "Identidad",
			drive: "Drive",
			editor: "Editor de imágenes",
			mail: "Correo",
			help: "Ayuda",
			"my-account": "Mi cuenta",
			org: "Organizaciones",
			status: "Estado"
		}
	}
};
