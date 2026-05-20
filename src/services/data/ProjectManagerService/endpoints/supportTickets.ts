import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import type { CreateSupportTicketInput, SupportTicketType } from "@common/types/project-manager/SupportTicket.ts";
import { SUPPORT_TICKET_CONSTRAINTS, EMAIL_REGEX } from "@common/types/project-manager/SupportTicket.ts";
import type ProjectManagerService from "../index.js";

// Rate limiting: 10 tickets máximo cada 3 días por IP
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const SUPPORT_TICKET_RATE_LIMIT = { max: 10, timeWindow: THREE_DAYS_MS };

// Destructure constraints from common types
const { title: TITLE_CONSTRAINTS, description: DESCRIPTION_CONSTRAINTS, email: EMAIL_CONSTRAINTS, attachmentUrls: ATTACHMENT_CONSTRAINTS } = SUPPORT_TICKET_CONSTRAINTS;
const VALID_TICKET_TYPES: SupportTicketType[] = ["complaint", "suggestion", "security"];

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
	if (email.length > EMAIL_CONSTRAINTS.max || !EMAIL_REGEX.test(email)) {
		throw new ProjectManagerError(400, "INVALID_FIELD", "`email` no es válido");
	}
	return email;
}

function validateTitle(value: unknown): string {
	const title = requireTrimmedString(value, "title");
	if (title.length < TITLE_CONSTRAINTS.min) {
		throw new ProjectManagerError(
			400,
			"INVALID_FIELD",
			`\`title\` debe tener al menos ${TITLE_CONSTRAINTS.min} caracteres`
		);
	}
	if (title.length > TITLE_CONSTRAINTS.max) {
		throw new ProjectManagerError(
			400,
			"INVALID_FIELD",
			`\`title\` no puede exceder ${TITLE_CONSTRAINTS.max} caracteres`
		);
	}
	return title;
}

function validateDescription(value: unknown): string {
	const description = requireTrimmedString(value, "description");
	if (description.length < DESCRIPTION_CONSTRAINTS.min) {
		throw new ProjectManagerError(
			400,
			"INVALID_FIELD",
			`\`description\` debe tener al menos ${DESCRIPTION_CONSTRAINTS.min} caracteres`
		);
	}
	if (description.length > DESCRIPTION_CONSTRAINTS.max) {
		throw new ProjectManagerError(
			400,
			"INVALID_FIELD",
			`\`description\` no puede exceder ${DESCRIPTION_CONSTRAINTS.max} caracteres`
		);
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

function validateUrls(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) throw new ProjectManagerError(400, "INVALID_FIELD", "`attachmentUrls` debe ser un array");

	if (value.length > ATTACHMENT_CONSTRAINTS.max) {
		throw new ProjectManagerError(
			400,
			"INVALID_FIELD",
			`Máximo ${ATTACHMENT_CONSTRAINTS.max} URLs permitidas, recibido: ${value.length}`
		);
	}

	return value.map((url, index) => {
		const urlStr = readTrimmedString(url);
		if (!urlStr) throw new ProjectManagerError(400, "INVALID_FIELD", `URL ${index + 1} no es válida`);
		if (urlStr.length > ATTACHMENT_CONSTRAINTS.urlMax) {
			throw new ProjectManagerError(
				400,
				"INVALID_FIELD",
				`URL ${index + 1} excede longitud máxima de ${ATTACHMENT_CONSTRAINTS.urlMax} caracteres`
			);
		}
		try {
			new URL(urlStr);
			return urlStr;
		} catch {
			throw new ProjectManagerError(400, "INVALID_FIELD", `URL ${index + 1} no es una URL válida`);
		}
	});
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
		attachmentUrls: validateUrls(record.attachmentUrls),
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
	 * @param {string[]} [attachmentUrls] - URLs de adjuntos (máximo 10, máximo 2048 caracteres cada una)
	 *
	 * @returns {SupportTicketIssueResponse} ID y clave del ticket creado
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/pm/support-tickets",
		options: { rateLimit: SUPPORT_TICKET_RATE_LIMIT },
	})
	static async create(ctx: EndpointCtx<never, CreateSupportTicketInput>) {
		const input = normalizeInput(ctx.data);

		return SupportTicketEndpoints.service.supportTickets.create(SupportTicketEndpoints.kernelKey, input, {
			userId: ctx.user!.id,
			email: ctx.user?.email,
			ip: ctx.ip,
		});
	}
}
