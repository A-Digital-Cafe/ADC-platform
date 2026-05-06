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
		COMMENT_BAD_EMOJI: "Emoji inválido"
	}
};
