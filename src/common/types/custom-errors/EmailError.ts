import ADCCustomError from "../ADCCustomError.ts";

type EmailErrorTypes =
	// Validación
	| "MISSING_FIELDS"
	| "INVALID_FIELD"
	| "INVALID_ADDRESS"
	| "INVALID_RECIPIENTS"
	| "INVALID_SCHEDULE"
	// Recursos
	| "MESSAGE_NOT_FOUND"
	| "ACCOUNT_NOT_FOUND"
	/** La dirección del buzón a crear ya pertenece a otro usuario. */
	| "MAIL_ADDRESS_TAKEN"
	| "ATTACHMENT_NOT_FOUND"
	| "FOLDER_NOT_FOUND"
	/** Ya hay una regla de remitente con ese valor en la misma lista. */
	| "SPAM_RULE_EXISTS"
	/** La regla de remitente no existe, o es de otra lista. */
	| "SPAM_RULE_NOT_FOUND"
	// Tier / cuota
	| "QUOTA_EXCEEDED"
	| "STORAGE_FULL"
	| "ATTACHMENT_TOO_LARGE"
	| "TOO_MANY_RECIPIENTS"
	| "TOO_MANY_SCHEDULED"
	| "TOO_MANY_SENDER_RULES"
	// Política de entrega
	| "EXTERNAL_SEND_DISABLED"
	| "RECIPIENT_NOT_FOUND"
	// No hay ninguna casilla del titular a la que entregar (garantía `any-mailbox`)
	| "NO_DELIVERABLE_MAILBOX"
	// Auth
	| "INVALID_WEBHOOK_SECRET"
	/** El grupo de direcciones de sistema pedido no existe en el catálogo. */
	| "MAIL_GROUP_NOT_FOUND"
	// Infra
	| "MAIL_UNAVAILABLE"
	| "TRANSPORT_UNAVAILABLE"
	| "ATTACHMENTS_UNAVAILABLE";

export class EmailError extends ADCCustomError<Record<string, unknown>, EmailErrorTypes> {
	public readonly name = "EmailError";
}
