export default {
	banned: {
		title: "Acceso bloqueado",
		subtitle: "Tu acceso a la plataforma ha sido restringido.",
		defaultReason: "La cuenta o IP fue marcada por moderación.",
		hint: "Si crees que es un error, contacta a soporte.",
	},
	csrf: {
		title: "Error de seguridad",
		subtitle: "Validación de estado fallida.",
		description: "Detectamos un posible intento de CSRF durante la autenticación. Por seguridad, el flujo se interrumpió.",
		hint: "Vuelve a iniciar sesión desde el principio.",
	},
	oauth: {
		title: "Error de autenticación externa",
		subtitle: "No pudimos completar el inicio de sesión.",
		subtitleProvider: "No pudimos completar el inicio de sesión con {{provider}}.",
		defaultMessage: "Ocurrió un problema durante la autenticación con el proveedor.",
		hint: "Vuelve a intentarlo o usa otro método.",
	},
	generic: {
		title: "Algo salió mal",
		subtitle: "Ha ocurrido un error inesperado.",
		defaultMessage: "No pudimos procesar tu solicitud.",
		hint: "Vuelve a intentarlo más tarde.",
	},
};
