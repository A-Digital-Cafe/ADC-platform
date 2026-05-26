import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import type { CreateSupportTicketInput, SupportTicketType } from "@common/types/project-manager/SupportTicket.ts";
import { SUPPORT_TICKET_VALIDATORS, validateStringField, TICKET_TYPE_LABELS } from "@common/types/project-manager/SupportTicket.ts";
import type ProjectManagerService from "../index.js";

// Rate limiting: 10 tickets máximo cada 3 días por IP
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const SUPPORT_TICKET_RATE_LIMIT = { max: 5, timeWindow: THREE_DAYS_MS };

// Extract valid types from TICKET_TYPE_LABELS to avoid duplication
const VALID_TICKET_TYPES = Object.keys(TICKET_TYPE_LABELS) as SupportTicketType[];

function readTrimmedString(value: unknown): string | undefined {
	return typeof value === "string" ? value.trim() : undefined;
}

function requireTrimmedString(value: unknown, field: string): string {
	const trimmed = readTrimmedString(value);
	if (!trimmed) throw new ProjectManagerError(400, "MISSING_FIELDS", `\`${field}\` es requerido`);
	return trimmed;
}

function normalizeEmail(value: unknown): string {
	const email = requireTrimmedString(value, "email").toLowerCase();
	const validation = validateStringField(email, SUPPORT_TICKET_VALIDATORS.email);

	if (!validation.valid) {
		// Return error code for frontend i18n translation (format: field:code)
		throw new ProjectManagerError(400, "INVALID_FIELD", `email:${validation.reason}`);
	}
	return email;
}

function validateTitle(value: unknown): string {
	const title = requireTrimmedString(value, "title");
	const validation = validateStringField(title, SUPPORT_TICKET_VALIDATORS.title);

	if (!validation.valid) {
		// Return error code for frontend i18n translation (format: field:code)
		throw new ProjectManagerError(400, "INVALID_FIELD", `title:${validation.reason}`);
	}
	return title;
}

function validateDescription(value: unknown): string {
	const description = requireTrimmedString(value, "description");
	const validation = validateStringField(description, SUPPORT_TICKET_VALIDATORS.description);

	if (!validation.valid) {
		// Return error code for frontend i18n translation (format: field:code)
		throw new ProjectManagerError(400, "INVALID_FIELD", `description:${validation.reason}`);
	}
	return description;
}

function validateTicketType(value: unknown): SupportTicketType {
	const type = readTrimmedString(value);
	if (!type || !VALID_TICKET_TYPES.includes(type as SupportTicketType)) {
		throw new ProjectManagerError(400, "INVALID_FIELD", `\`type\` debe ser uno de: ${VALID_TICKET_TYPES.join(", ")}`);
	}
	return type as SupportTicketType;
}

function normalizeInput(data: unknown): CreateSupportTicketInput {
	const record = (data ?? {}) as Record<string, unknown>;

	const type = validateTicketType(record.type);
	const title = validateTitle(record.title);
	const description = validateDescription(record.description);

	return {
		type,
		title,
		email: normalizeEmail(record.email),
		description,
	};
}

export class SupportTicketEndpoints {
	private static service: ProjectManagerService;
	private static kernelKey: symbol;

	static init(service: ProjectManagerService, kernelKey: symbol): void {
		SupportTicketEndpoints.service ??= service;
		SupportTicketEndpoints.kernelKey ??= kernelKey;
	}

	/**
	 * Crea un ticket de soporte (solo usuarios autenticados)
	 *
	 * Registra la información del usuario reportante:
	 * - userId: ID del usuario autenticado
	 * - email: Email del usuario autenticado
	 * - ip: IP del cliente para análisis de patrón
	 *
	 * Rate limit: 10 tickets máximo cada 3 días por IP
	 *
	 * @param {string} type - Tipo de ticket: "complaint", "suggestion", o "security"
	 * @param {string} title - Título del ticket (5-200 caracteres)
	 * @param {string} description - Descripción detallada (10-5000 caracteres)
	 * @param {string} email - Email de contacto (validado con RFC regex)
	 *
	 * @returns {SupportTicketIssueResponse} ID y clave del ticket creado
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/pm/support-tickets",
		options: { rateLimit: SUPPORT_TICKET_RATE_LIMIT },
	})
	static async create(ctx: EndpointCtx<never, CreateSupportTicketInput>) {
		if (!ctx.user?.id) throw new ProjectManagerError(401, "NO_TOKEN", "Debes iniciar sesión para crear un ticket de soporte");
		const input = normalizeInput(ctx.data);

		return SupportTicketEndpoints.service.supportTickets.create(SupportTicketEndpoints.kernelKey, input, {
			userId: ctx.user.id,
			email: ctx.user.email,
		});
	}
}
