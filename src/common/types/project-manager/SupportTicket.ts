import type { SupportTicketType } from "./CommonTicketColumns.ts";
export { TICKET_TYPE_LABELS, TICKET_TYPE_CATEGORIES } from "./CommonTicketColumns.ts";

export type { SupportTicketType };

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

/** Límites de los campos opcionales de bug bounty. */
export const BUG_BOUNTY_FIELD_CONSTRAINTS = {
	creditName: { max: 80 },
} as const;

export interface SupportTicketIssueResponse {
	ticketId: string;
	ticketKey: string;
	message: string;
}

export interface SupportTicketCaller {
	userId: string;
	email?: string;
}

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

/** Validators para support tickets (F/B) */
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
