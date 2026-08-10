/**
 * Tipos de límites de correo y su piso base.
 *
 * Este archivo se queda en `@common` (y no en el preset) porque lo comparten
 * DOS presets distintos: `adc-email-backend` (resolver y DAOs) y
 * `adc-email-frontend` (tipos de `mail-api.ts`) — y los presets no pueden
 * importarse entre sí. Sólo tipos y el piso `free`/`default`: las matrices de
 * los tiers pagos viven en `plan_definitions` (motor de planes) y sus defaults
 * de desarrollo en `adc-email-backend` (`utils/plan-features.ts`).
 *
 * Los límites de **envío diario** se dimensionan por lo que manda una persona
 * real, no por lo que aguanta el MTA: un tope alto es un vector de spam que
 * puede hacer que bloqueen el dominio de correo entero.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Cuotas por usuario. */
export interface EmailUserTierLimits {
	/** Almacenamiento total del buzón (bytes). */
	storageBytes: number;
	/** Envíos permitidos por día (rolling 24h). */
	dailySendLimit: number;
	/** Tamaño máximo por adjunto (bytes). */
	maxAttachmentBytes: number;
	/** Destinatarios máximos (to+cc+bcc) por mensaje. */
	maxRecipientsPerMessage: number;
	/** Correos programados activos simultáneos. */
	maxScheduledMessages: number;
}

/** Cuotas agregadas por organización (dominio de correo). */
export interface EmailOrgTierLimits {
	/** Cuentas de correo que la organización puede tener. */
	maxMailAccounts: number;
	/** Almacenamiento total del dominio de la organización (bytes). */
	orgStorageBytes: number;
	/** Envíos agregados de la organización por día. */
	orgDailySendLimit: number;
}

/**
 * Piso del plan gratuito: fallback sin `PlanService` (degradar al tier base es
 * la convención de la plataforma) y default `free` que el backend registra.
 * @public
 */
export const EMAIL_USER_BASE_LIMITS: EmailUserTierLimits = {
	storageBytes: 250 * MB,
	dailySendLimit: 20,
	maxAttachmentBytes: 25 * MB,
	maxRecipientsPerMessage: 20,
	maxScheduledMessages: 5,
};

/** Piso del tier `default` de organización. */
export const EMAIL_ORG_BASE_LIMITS: EmailOrgTierLimits = {
	maxMailAccounts: 3,
	orgStorageBytes: 1 * GB,
	orgDailySendLimit: 50,
};
