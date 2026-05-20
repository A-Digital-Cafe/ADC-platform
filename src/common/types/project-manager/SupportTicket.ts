import type { SupportTicketType } from "./CommonTicketColumns.ts";
import { TICKET_TYPE_LABELS, TICKET_TYPE_CATEGORIES } from "./CommonTicketColumns.ts";

export type { SupportTicketType };

export interface SupportTicketSocialNetwork {
	platform: string;
	url: string;
}

export interface CreateSupportTicketInput {
	type: SupportTicketType;
	title: string;
	email: string;
	description: string;
	attachmentUrls?: string[];
}

export interface SupportTicketIssueResponse {
	ticketId: string;
	ticketKey: string;
	message: string;
}

export interface SupportTicketCaller {
	userId: string;
	email?: string;
	ip: string;
}

export interface SupportTicketConfig {
	supportTicketsProjectId?: string;
}

/**
 * Límites de validación para support tickets.
 * Una fuente de verdad para frontend y backend.
 */
export const SUPPORT_TICKET_CONSTRAINTS = {
	title: { min: 5, max: 200 },
	description: { min: 10, max: 5000 },
	email: { max: 254 },
	attachmentUrls: { max: 10, urlMax: 2048 },
} as const;

/**
 * Regex para validar email addresses (RFC-like).
 * Mantener sincronizado con backend.
 */
export const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/u;

export { TICKET_TYPE_LABELS, TICKET_TYPE_CATEGORIES };
