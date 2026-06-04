export const EMAIL_RESOURCE_NAME = "email" as const;

/**
 * Scopes del recurso `email` (bitfield).
 */
export const EmailScopes = {
	NONE: 0,
	MESSAGES: 1, // 1 — leer/mover/eliminar mensajes
	SEND: 1 << 1, // 2 — enviar/programar
	DRAFTS: 1 << 2, // 4 — borradores
	ATTACHMENTS: 1 << 3, // 8 — adjuntos
	ACCOUNTS: 1 << 4, // 16 — administrar cuentas de correo
	SETTINGS: 1 << 5, // 32
	SELF: 1 << 15, // 32768
	ALL: 1 | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5), // 63
} as const;

export type EmailScopeValue = (typeof EmailScopes)[keyof typeof EmailScopes];
