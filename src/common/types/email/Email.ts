import type { CapabilityToken } from "../../security/Capability.ts";

/** Dirección de correo (RFC 5322 simplificada). */
export interface EmailAddress {
	name?: string;
	address: string;
}

/** @public Carpetas del buzón. */
export type EmailFolder = "inbox" | "sent" | "drafts" | "spam" | "trash";

/** Dirección del flujo del mensaje. */
type EmailDirection = "inbound" | "outbound";

/** @public Veredicto de una comprobación de autenticación; `none` = el remitente no la publica. */
export type AuthVerdict = "pass" | "fail" | "none";

/** Resultado de autenticación del remitente, tal como lo vio el MTA. */
export interface EmailAuthResults {
	spf: AuthVerdict;
	dkim: AuthVerdict;
	dmarc: AuthVerdict;
	/** Dominio del sobre SMTP que pasó SPF (el "mailed-by"); `null` si no pasó. */
	mailedBy?: string | null;
	/** Dominio `d=` de la firma DKIM válida (el "signed-by"); `null` si no hay firma válida. */
	signedBy?: string | null;
}

/** @public Cifrado de la conexión SMTP por la que entró el correo. */
export interface EmailTransportSecurity {
	version: string | null;
	cipher: string | null;
}

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
	/** HTML saneado del cuerpo. Vacío si el cuerpo se derramó a objetos (ver `bodyKey`). */
	bodyHtml: string;
	/**
	 * Clave del objeto con el cuerpo HTML, cuando superó el umbral inline.
	 *
	 * Un GB en la base cuesta bastante más que un GB de objetos y el HTML es lo que más
	 * crece; `bodyText` sí se queda en el documento porque lo usa la búsqueda. Es un
	 * detalle de persistencia: la API siempre devuelve el cuerpo ya rehidratado.
	 */
	bodyKey?: string | null;
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

	/**
	 * Cuándo **entró** el mensaje a la papelera (`null` fuera de ella). De acá parte la retención:
	 * `updatedAt` no sirve porque lo mueve cualquier cambio (marcar leído, destacar), así que abrir
	 * un mensaje en la papelera le reiniciaría el plazo de borrado.
	 */
	trashedAt?: Date | null;

	/** Programación de envío. */
	scheduledAt?: Date | null;
	sentAt?: Date | null;
	receivedAt?: Date | null;

	/** Tamaño total estimado (cuerpo + adjuntos) en bytes. */
	sizeBytes: number;
	/** Puntuación antispam, 0-100 (0 = limpio). */
	spamScore?: number;
	/** Por qué quedó en esa carpeta: `"blocked:global"`, `"blocked:user"`, `"allow:user"`, `"score"`, … */
	spamReason?: string | null;
	/** Veredicto de autenticación del MTA; `null` si el correo no pasó por él (entrega interna). */
	authResults?: EmailAuthResults | null;
	/** Cifrado de la conexión entrante; `null` = en claro, o el correo no pasó por el MTA. */
	transportSecurity?: EmailTransportSecurity | null;
	/** Último error de envío, si lo hubo. */
	error?: string;

	createdAt: Date;
	updatedAt: Date;
}

/**
 * Tenant de los buzones personales, que no cuelgan de ninguna organización.
 *
 * Los `orgId` reales son UUID, así que no puede colisionar, y mantiene `orgId` como `string`
 * requerido en los schemas. Nunca se usa para resolver una organización: quien distingue el ámbito
 * es `MailAccount.scope`. Además está reservado como slug (`checkOrgSlug`), porque la resolución de
 * organizaciones acepta `orgId` **o** `slug`.
 * @public
 */
export const PERSONAL_ORG_ID = "personal";

/** Cuenta de correo de un usuario: personal o dentro de una organización. */
export interface MailAccount {
	id: string;
	/** Organización dueña del buzón, o {@link PERSONAL_ORG_ID} si es personal. */
	orgId: string;
	userId: string;
	/**
	 * Ámbito de la cuenta y, por tanto, de qué cuota descuenta su almacenamiento:
	 * - `"org"`: buzón de organización → descuenta de la cuota de la organización.
	 * - `"user"`: buzón personal → descuenta de la cuota del usuario.
	 * Por defecto `"org"` (compatibilidad con cuentas existentes).
	 */
	scope?: "user" | "org";
	/**
	 * Dirección completa: `usuario@<orgSlug>.<raíz>` para buzones de organización,
	 * `usuario@<raíz>` para los personales.
	 */
	address: string;
	displayName: string;
	/**
	 * Direcciones anteriores del buzón, en orden cronológico (la parte local se deriva
	 * del username, así que cambia con él). Es el registro que permite atribuir un
	 * correo salido de `viejo@<raíz>` a la cuenta que hoy se llama distinto: sin él,
	 * renombrar el username borraría la procedencia de lo ya enviado.
	 *
	 * Se conserva sólo la dirección y el momento del cambio (nada de contenido), se
	 * acota a las últimas {@link MAILBOX_ADDRESS_HISTORY_LIMIT} y se purga junto con la
	 * cuenta en la baja del titular.
	 */
	previousAddresses?: MailboxAddressChange[];
	/** Contador incremental de almacenamiento usado (bytes). */
	storageUsedBytes: number;
	createdAt: Date;
	updatedAt: Date;
}

/** Entrada del historial de direcciones de un buzón. */
interface MailboxAddressChange {
	address: string;
	changedAt: Date;
}

/** @public Tope del historial de direcciones por buzón (minimización: no hace falta más). */
export const MAILBOX_ADDRESS_HISTORY_LIMIT = 10;

/** Resultado de renombrar los buzones de un usuario (o del pre-flight `dryRun`). */
export interface MailboxRenameResult {
	/** Buzones cuya dirección cambió (o cambiaría, en `dryRun`). */
	renamed: Array<{ from: string; to: string }>;
	/** Buzones cuya dirección destino ya está ocupada por otro titular. */
	conflicts: Array<{ from: string; to: string }>;
}

/**
 * Superficie que el `EmailService` expone a IdentityManager para mantener las
 * direcciones alineadas con el username. Se resuelve por duck-typing (el preset de
 * correo es opcional) y exige capability con scope `identity:internal`, igual que el
 * export y la purga de datos personales.
 */
export interface IMailboxRenamer {
	renameUserMailboxes(cap: CapabilityToken, userId: string, newUsername: string, opts?: { dryRun?: boolean }): Promise<MailboxRenameResult>;
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

/** @public Granularidad de una regla o reputación: una dirección exacta o todo un dominio. */
export type SpamMatchType = "address" | "domain";

/** @public Alcance de una regla: propia del usuario o curada por un admin para toda la plataforma. */
export type SpamRuleScope = "user" | "global";

/** @public Sentido de la regla: bloquear el remitente o dejarlo pasar siempre. */
export type SpamRuleKind = "block" | "allow";

/** Regla de remitente. Se aplica en la entrega (no en el MTA): manda el correo a `spam`, nunca lo descarta. */
export interface MailSenderRule {
	id: string;
	scope: SpamRuleScope;
	/** `null` cuando el `scope` es `"global"`. */
	ownerUserId: string | null;
	kind: SpamRuleKind;
	matchType: SpamMatchType;
	/** Ya normalizado (ver `normalizeAddress`), porque el match es por igualdad exacta. */
	value: string;
	reason: string;
	createdBy: string;
	createdAt: Date;
	/** `null` = no vence. El vencimiento lo filtra la consulta; el documento lo borra un barrido. */
	expiresAt: Date | null;
}

/** Reputación **personal** de un remitente: lo que este usuario marcó como spam o como legítimo. */
export interface MailSenderReputation {
	ownerUserId: string;
	matchType: SpamMatchType;
	value: string;
	spamReports: number;
	hamReports: number;
	lastMessageAt: Date;
	updatedAt: Date;
}

/** Denuncia agregada entre usuarios; insumo del admin para promover un remitente a la lista global. */
export interface MailSpamReport {
	matchType: SpamMatchType;
	value: string;
	reporterUserIds: string[];
	firstSeenAt: Date;
	lastSeenAt: Date;
	status: "pending" | "promoted" | "dismissed";
}

/**
 * @public Qué hacer con un adjunto entrante que no entra en la cuota del destinatario.
 *
 * `drive-link` guarda el archivo en el Drive del titular (carpeta `email-attachments`) y deja un
 * enlace en el mensaje: el correo llega completo y el archivo cuenta contra la cuota de Drive.
 * `reject` responde al MTA que reintente y termina en rebote, así el remitente se entera.
 */
export type AttachmentOverflowPolicy = "drive-link" | "reject";

/** @public Carpeta de Drive donde caen los adjuntos desbordados. Se recrea sola si la borran. */
export const EMAIL_ATTACHMENTS_FOLDER = "email-attachments";

/** @public Densidad de la lista de mensajes. */
export type MailListDensity = "comfortable" | "compact";

/**
 * Preferencias del titular del buzón. Documento por usuario, creado al primer guardado: la
 * ausencia es un usuario que nunca tocó la configuración, y ahí valen los defaults.
 */
export interface MailUserSettings {
	userId: string;
	attachmentOverflow: AttachmentOverflowPolicy;
	/** Marcar el mensaje como leído al abrirlo. Apagado deja el control en el botón de la lista. */
	autoMarkRead: boolean;
	listDensity: MailListDensity;
	updatedAt: Date;
}

/** Valores con los que se responde mientras el usuario no haya guardado nada. */
export const MAIL_USER_SETTINGS_DEFAULTS: Omit<MailUserSettings, "userId" | "updatedAt"> = {
	attachmentOverflow: "drive-link",
	autoMarkRead: true,
	listDensity: "comfortable",
};
