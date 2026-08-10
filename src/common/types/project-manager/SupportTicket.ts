/**
 * Tipo de ticket de soporte que un usuario puede abrir:
 * reclamos, sugerencias, reportes de seguridad (bug bounty),
 * solicitudes de datos (GDPR / takedown de terceros) y
 * solicitudes de quien ejerce la responsabilidad parental sobre un menor.
 *
 * Contrato F/B: lo consumen el frontend de `status` (formulario) y el backend
 * del PM (creación del issue). Por eso vive en `@common`.
 * @public
 */
export type SupportTicketType = "complaint" | "suggestion" | "security" | "data" | "expansion" | "minor";

/**
 * Tipos que se aceptan **sin sesión**: los canales que los documentos legales
 * ofrecen a "cualquier persona", tenga o no cuenta —quien reporta contenido de
 * un tercero y quien ejerce la responsabilidad parental sobre un menor, que por
 * definición no es titular de la cuenta afectada—.
 * @public
 */
export const ANONYMOUS_TICKET_TYPES: ReadonlySet<SupportTicketType> = new Set<SupportTicketType>(["data", "minor"]);

/**
 * Ticket abierto tal como lo ve una cola de moderación de otro módulo (hoy el panel
 * de Drive, sobre los reportes `data`).
 *
 * **No lleva el email de quien reportó.** La cola existe para decidir sobre el
 * contenido; quién denunció no hace falta para eso y su dato de contacto sólo debe
 * verse en el ticket, donde el acceso ya está acotado.
 * @public
 */
export interface OpenTicketEntry {
	ticketKey: string;
	title: string;
	/** ISO 8601. */
	createdAt: string;
	columnKey: string;
	/** Cuerpo del ticket en texto plano: es de donde se saca el enlace reportado. */
	description: string;
}

/** @public Label visible por tipo de ticket (usado por el form de `status` y el backend). */
export const TICKET_TYPE_LABELS: Record<SupportTicketType, string> = {
	complaint: "RECLAMO",
	suggestion: "SUGERENCIA",
	security: "SEGURIDAD",
	data: "DATOS",
	expansion: "AMPLIACIÓN",
	minor: "MENOR DE EDAD",
};

/**
 * Plantilla-guía por tipo de ticket: se precarga en la descripción al elegir el tipo
 * y se limpia si el usuario cambia de tipo sin haberla tocado.
 *
 * La de `expansion` no es decorativa: la ampliación de una organización se otorga a
 * criterio de la plataforma, y estos son los datos sobre los que se decide. Pedirlos
 * en el formulario evita el ida y vuelta de "contame más".
 * @public
 */
export const TICKET_TEMPLATES: Partial<Record<SupportTicketType, string>> = {
	security: "Pasos de reproducción:\n1.\n2.\n\nImpacto (a quién/qué afecta):\n\nAlcance (URL/endpoint/componente):\n\nSeveridad estimada (CVSS si tenés):\n",
	expansion:
		"Organización (nombre y enlace, si tiene):\n\n" +
		"A qué se dedica:\n\n" +
		"Cantidad de personas y para qué usan la plataforma:\n\n" +
		"Compromisos sociales o códigos de conducta que siguen:\n\n" +
		"Qué límite se les queda corto y por qué:\n",
	minor:
		"Nombre de usuario o email de la cuenta del menor:\n\n" +
		"Vínculo con el menor (madre, padre, tutor/a legal):\n\n" +
		"Qué pedís (supresión de la cuenta y sus datos, retiro de un contenido, otra cosa):\n\n" +
		"País de residencia del menor (determina la edad mínima aplicable):\n\n" +
		"No hace falta que adjuntes documentación en este primer mensaje: si necesitamos acreditar el vínculo te lo pedimos por este mismo canal.\n",
};

/** @public */
export interface CreateSupportTicketInput {
	type: SupportTicketType;
	title: string;
	email: string;
	description: string;
	/**
	 * Bug bounty (solo relevante para `type === "security"`):
	 * el reporter acepta agradecimiento público (su descripción y handle se
	 * publican en el log de transparencia al resolverse). Default: false.
	 */
	wantsCredit?: boolean;
	/** Handle/nombre para los agradecimientos públicos (si `wantsCredit`). */
	creditName?: string;
	/** Preferencia de recompensa del reporter (el admin la considera al otorgar). */
	rewardPreference?: "plus" | "pro";
}

/** @public Límites de los campos opcionales de bug bounty. */
export const BUG_BOUNTY_FIELD_CONSTRAINTS = {
	creditName: { max: 80 },
} as const;

/** @public */
export interface SupportTicketIssueResponse {
	ticketId: string;
	ticketKey: string;
	message: string;
}

/** @public */
export interface SupportTicketCaller {
	/** `null` en tickets anónimos (tipo `data` sin sesión). */
	userId: string | null;
	email?: string;
}

/** @public */
export interface SupportTicketConfig {
	supportTicketsProjectId?: string;
	/** Proyecto compartido de org-management; fallback cuando no hay uno específico. */
	orgManagementProjectId?: string;
}

/** Límites de validación para support tickets
 * @public
 */
export const SUPPORT_TICKET_CONSTRAINTS = {
	title: { min: 5, max: 200 },
	description: { min: 10, max: 5000 },
	email: { max: 254 },
} as const;

/** Email regex (RFC-like) */
const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/u;

/** Opciones de tipos de ticket
 * @public
 */
export interface SelectOption {
	value: SupportTicketType;
	label: string;
}

export interface StringValidator {
	required?: boolean;
	minLength?: number;
	maxLength?: number;
	pattern?: RegExp;
}

/** @public Validators para support tickets (F/B) */
export const SUPPORT_TICKET_VALIDATORS: Record<string, StringValidator> = {
	title: {
		required: true,
		minLength: SUPPORT_TICKET_CONSTRAINTS.title.min,
		maxLength: SUPPORT_TICKET_CONSTRAINTS.title.max,
	},
	email: {
		required: true,
		maxLength: SUPPORT_TICKET_CONSTRAINTS.email.max,
		pattern: EMAIL_REGEX,
	},
	description: {
		required: true,
		minLength: SUPPORT_TICKET_CONSTRAINTS.description.min,
		maxLength: SUPPORT_TICKET_CONSTRAINTS.description.max,
	},
};

/** @public */
export function validateStringField(
	value: string,
	validator: StringValidator
): { valid: true } | { valid: false; reason: "required" | "minLength" | "maxLength" | "pattern" } {
	if (validator.required && !value) {
		return { valid: false, reason: "required" };
	}

	if (validator.minLength && value.length < validator.minLength) {
		return { valid: false, reason: "minLength" };
	}

	if (validator.maxLength && value.length > validator.maxLength) {
		return { valid: false, reason: "maxLength" };
	}

	if (validator.pattern && !validator.pattern.test(value)) {
		return { valid: false, reason: "pattern" };
	}

	return { valid: true };
}
