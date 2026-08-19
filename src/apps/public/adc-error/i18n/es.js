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
	unauthorized: {
		title: "Acceso restringido",
		subtitle: "Esta sección no está disponible para tu cuenta.",
		subtitleApp: "«{{app}}» no está disponible para tu cuenta.",
		auth: "Necesitás iniciar sesión para acceder a esta sección.",
		role: "Tu cuenta no tiene un rol habilitado para esta sección.",
		org: "Esta sección administra la plataforma y no una organización: entrá con tu cuenta personal, fuera de la organización.",
		unavailable: "El sistema de cuentas no está disponible en este momento, así que no podemos verificar tu acceso.",
		login: "Iniciar sesión",
		hint: "Si creés que deberías tener acceso, pedíselo a un administrador de la plataforma.",
	},
	generic: {
		title: "Algo salió mal",
		subtitle: "Ha ocurrido un error inesperado.",
		defaultMessage: "No pudimos procesar tu solicitud.",
		hint: "Vuelve a intentarlo más tarde.",
	},
};
