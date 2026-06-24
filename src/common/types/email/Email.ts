/** Dirección de correo (RFC 5322 simplificada). */
export interface EmailAddress {
	name?: string;
	address: string;
}

/** Carpetas del buzón. */
export type EmailFolder = "inbox" | "sent" | "drafts" | "spam" | "trash";

/** Dirección del flujo del mensaje. */
type EmailDirection = "inbound" | "outbound";

/**
 * Estado del mensaje:
 * - `draft`: borrador editable.
 * - `scheduled`: programado para envío futuro (`scheduledAt`).
 * - `pending`: encolado para envío.
 * - `sending`: en proceso de relay.
 * - `sent`: relay aceptado por el MTA.
 * - `failed`: falló el envío tras reintentos.
 * - `received`: mensaje entrante almacenado.
 */
type EmailStatus = "draft" | "scheduled" | "pending" | "sending" | "sent" | "failed" | "received";

/**
 * Mensaje de correo. Cada copia (entrante/saliente) es un documento propio,
 * particionado por `orgId` en la base `adc-mail`.
 */
export interface EmailMessage {
	id: string;
	/** Tenant: organización dueña del dominio de correo. */
	orgId: string;
	/** Cuenta de correo (buzón) dueña de esta copia. */
	accountId: string;
	/** Usuario propietario del buzón. */
	ownerUserId: string;

	folder: EmailFolder;
	direction: EmailDirection;
	status: EmailStatus;

	from: EmailAddress;
	to: EmailAddress[];
	cc: EmailAddress[];
	bcc: EmailAddress[];
	replyTo?: EmailAddress;

	subject: string;
	/** HTML saneado del cuerpo. */
	bodyHtml: string;
	/** Texto plano alternativo. */
	bodyText: string;

	attachmentIds: string[];

	/** Cabeceras RFC para threading. */
	messageId?: string;
	inReplyTo?: string;
	references?: string[];
	threadId?: string;

	read: boolean;
	starred: boolean;

	/** Programación de envío. */
	scheduledAt?: Date | null;
	sentAt?: Date | null;
	receivedAt?: Date | null;

	/** Tamaño total estimado (cuerpo + adjuntos) en bytes. */
	sizeBytes: number;
	/** Puntuación antispam de las reglas básicas (0 = limpio). */
	spamScore?: number;
	/** Último error de envío, si lo hubo. */
	error?: string;

	createdAt: Date;
	updatedAt: Date;
}

/** Cuenta de correo de un usuario dentro de una organización. */
export interface MailAccount {
	id: string;
	orgId: string;
	userId: string;
	/**
	 * Ámbito de la cuenta y, por tanto, de qué cuota descuenta su almacenamiento:
	 * - `"org"`: buzón de organización → descuenta de la cuota de la organización.
	 * - `"user"`: buzón personal → descuenta de la cuota del usuario.
	 * Por defecto `"org"` (compatibilidad con cuentas existentes).
	 */
	scope?: "user" | "org";
	/** Dirección completa: `usuario@<orgSlug>.adigitalcafe.com`. */
	address: string;
	displayName: string;
	/** Contador incremental de almacenamiento usado (bytes). */
	storageUsedBytes: number;
	createdAt: Date;
	updatedAt: Date;
}

/** Registro de un envío para enforcement de cuota diaria. */
export interface EmailSendLog {
	id: string;
	orgId: string;
	accountId: string;
	userId: string;
	recipients: number;
	createdAt: Date;
}
