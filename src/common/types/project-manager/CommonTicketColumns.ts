export type SupportTicketType = "complaint" | "suggestion" | "security";

/**
 * Columnas tipadas del proyecto común donde se guardan:
 * - Solicitudes de organizaciones
 * - Tickets de soporte (reclamos, sugerencias, reportes de seguridad)
 */
export type CommonTicketColumnKey = "organizations" | "support" | "security";

/**
 * Mapea tipos de support tickets a sus labels.
 */
export const TICKET_TYPE_LABELS: Record<SupportTicketType, string> = {
	complaint: "RECLAMO",
	suggestion: "SUGERENCIA",
	security: "SEGURIDAD",
};

/**
 * Mapea tipos de support tickets a sus categorías de issue.
 */
export const TICKET_TYPE_CATEGORIES: Record<SupportTicketType, string> = {
	complaint: "bug",
	suggestion: "task",
	security: "security",
};

/**
 * Mapea tipos de tickets/solicitudes a su columna en el proyecto común de tickets.
 * Garantiza que cada tipo de ticket se asigne a una columna específica.
 */
export const TICKET_COLUMN_MAP = {
	"org-request": "organizations",
	complaint: "support",
	suggestion: "support",
	security: "security",
} as const satisfies Record<"org-request" | SupportTicketType, CommonTicketColumnKey>;
