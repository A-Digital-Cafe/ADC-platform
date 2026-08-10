/**
 * Tipo de ticket de soporte que un usuario puede abrir:
 * reclamos, sugerencias, reportes de seguridad (bug bounty),
 * solicitudes de datos (GDPR / takedown de terceros),
 * solicitudes de quien ejerce la responsabilidad parental sobre un menor y
 * requerimientos de autoridades públicas (judiciales, administrativas o regulatorias).
 *
 * Contrato F/B: lo consumen el frontend de `status` (formulario) y el backend
 * del PM (creación del issue). Por eso vive en `@common`.
 * @public
 */
export type SupportTicketType = "complaint" | "suggestion" | "security" | "data" | "expansion" | "minor" | "authority";

/**
 * Tipos que se aceptan **sin sesión**: los canales que los documentos legales
 * ofrecen a "cualquier persona", tenga o no cuenta —quien reporta contenido de
 * un tercero, quien ejerce la responsabilidad parental sobre un menor (que por
 * definición no es titular de la cuenta afectada) y una autoridad pública, que
 * no tiene ni tiene por qué tener cuenta—.
 * @public
 */
export const ANONYMOUS_TICKET_TYPES: ReadonlySet<SupportTicketType> = new Set<SupportTicketType>(["data", "minor", "authority"]);

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
	authority: "AUTORIDADES",
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
	security:
		"Pasos de reproducción:\n1.\n2.\n\nImpacto (a quién/qué afecta):\n\nAlcance (URL/endpoint/componente):\n\nSeveridad estimada (CVSS si tenés):\n",
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
	authority:
		"Organismo y unidad (fuerza, juzgado, fiscalía, organismo de control):\n\n" +
		"Carátula y número de expediente o actuación:\n\n" +
		"Norma que faculta el requerimiento:\n\n" +
		"Funcionario/a firmante, cargo y forma de contacto OFICIAL (dominio institucional):\n\n" +
		"Alcance exacto (cuenta, URL, rango temporal). Un pedido de 'todo lo que tenga esa persona' se devuelve para acotar:\n\n" +
		"Plazo de respuesta requerido:\n\n" +
		"¿Existe prohibición de notificar al titular? Si es así, indicá la norma y el plazo:\n\n" +
		"Adjuntá el oficio o resolución. Un pedido informal (llamado, mensaje, correo sin instrumento) no se procesa: ver https://help.adigitalcafe.com/authority-requests\n",
};

/**
 * Retención post-resolución por tipo de ticket. El reloj arranca en `closedAt`.
 *
 * Existe porque la anonimización sólo corría en la cascada de baja (que necesita `userId`) y los
 * tickets anónimos —`data`, `minor`, `authority`— no tienen titular de cuenta: sin esto no se
 * borran nunca. `minor` es el único que además borra el cuerpo, porque su texto libre es, por
 * diseño de la plantilla, la identidad de un menor y su vínculo familiar recogidos de alguien
 * que no es el interesado.
 * @public
 */
export interface SupportTicketRetention {
	/** Días desde `closedAt` tras los que se borran los datos de contacto de quien reportó. */
	anonymizeAfterDays: number;
	/** Si además se reemplaza el cuerpo libre (el dato sensible está ahí, no en las etiquetas). */
	scrubBody: boolean;
	/** Días desde `closedAt` tras los que se borra el ticket entero. `null` = nunca. */
	purgeAfterDays: number | null;
}

/** @public Política vigente. Los números de acá son los que publica `/privacy` §5. */
export const SUPPORT_TICKET_RETENTION: Record<SupportTicketType, SupportTicketRetention> = {
	minor: { anonymizeAfterDays: 30, scrubBody: true, purgeAfterDays: 180 },
	data: { anonymizeAfterDays: 90, scrubBody: false, purgeAfterDays: 730 },
	authority: { anonymizeAfterDays: 365, scrubBody: false, purgeAfterDays: null },
	complaint: { anonymizeAfterDays: 180, scrubBody: false, purgeAfterDays: null },
	suggestion: { anonymizeAfterDays: 180, scrubBody: false, purgeAfterDays: null },
	expansion: { anonymizeAfterDays: 180, scrubBody: false, purgeAfterDays: null },
	security: { anonymizeAfterDays: 365, scrubBody: false, purgeAfterDays: null },
};

/**
 * Tope duro para un ticket que nadie cerró: sin `closedAt` el reloj no arranca nunca. Sólo se
 * aplica a `minor`, el único cuyo contenido no debería sobrevivir a un olvido administrativo.
 * @public
 */
export const MINOR_TICKET_MAX_OPEN_DAYS = 365;

/** @public Texto con el que se reemplaza un cuerpo purgado por retención. */
export const RETENTION_SCRUBBED_BODY = "(contenido eliminado por política de retención)";

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

interface StringValidator {
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
