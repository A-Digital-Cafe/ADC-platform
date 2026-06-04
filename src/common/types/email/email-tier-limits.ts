/**
 * Límites de correo por tier (personal y de organización).
 *
 * - Tier personal (`AccountTier`): cuotas por usuario.
 * - Tier de organización (`OrganizationTier`): cuotas agregadas del dominio de
 *   correo de la organización.
 *
 * El tier se resuelve fuera de aquí (ver `docs/structure/enterprise-apps.md`):
 * usuario → `user.metadata.accountTier`; org → `org.tier`.
 */

import type { AccountTier } from "../tiers.ts";
import type { OrganizationTier } from "../identity/Organization.ts";

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

const USER_LIMITS: Record<AccountTier, EmailUserTierLimits> = {
	free: {
		storageBytes: 1 * GB,
		dailySendLimit: 50,
		maxAttachmentBytes: 25 * MB,
		maxRecipientsPerMessage: 20,
		maxScheduledMessages: 5,
	},
	pro: {
		storageBytes: 10 * GB,
		dailySendLimit: 500,
		maxAttachmentBytes: 50 * MB,
		maxRecipientsPerMessage: 100,
		maxScheduledMessages: 50,
	},
	plus: {
		storageBytes: 100 * GB,
		dailySendLimit: 5000,
		maxAttachmentBytes: 100 * MB,
		maxRecipientsPerMessage: 500,
		maxScheduledMessages: 500,
	},
};

const ORG_LIMITS: Record<OrganizationTier, EmailOrgTierLimits> = {
	default: {
		maxMailAccounts: 5,
		orgStorageBytes: 5 * GB,
		orgDailySendLimit: 200,
	},
	team: {
		maxMailAccounts: 50,
		orgStorageBytes: 100 * GB,
		orgDailySendLimit: 5000,
	},
	enterprise: {
		maxMailAccounts: 1000,
		orgStorageBytes: 1024 * GB,
		orgDailySendLimit: 50000,
	},
};

export function getEmailUserTierLimits(tier: AccountTier = "free"): EmailUserTierLimits {
	return USER_LIMITS[tier] ?? USER_LIMITS.free;
}

export function getEmailOrgTierLimits(tier: OrganizationTier = "default"): EmailOrgTierLimits {
	return ORG_LIMITS[tier] ?? ORG_LIMITS.default;
}
