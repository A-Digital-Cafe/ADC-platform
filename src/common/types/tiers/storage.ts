/**
 * Matriz central de almacenamiento por tier: límites totales, mínimos
 * garantizados por app y tope default por miembro de organización.
 *
 * Contexto personal → `AccountTier` del usuario; contexto org →
 * `OrganizationTier` de la organización. Cada contexto lleva su propio
 * contador de uso, por lo que límites y mínimos aplican por (usuario, contexto).
 */

import type { AccountTier } from "../tiers.ts";
import type { OrganizationTier } from "../identity/Organization.ts";
import { UNLIMITED_BYTES } from "../storage/quota.ts";

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Límite total de almacenamiento por tier de cuenta personal. */
export const STORAGE_USER_TIER_LIMITS: Record<AccountTier, number> = {
	free: 250 * MB,
	pro: 5 * GB,
	plus: 20 * GB,
};

/** Límite total de almacenamiento por tier de organización. */
export const STORAGE_ORG_TIER_LIMITS: Record<OrganizationTier, number> = {
	default: 1 * GB,
	team: 50 * GB,
	enterprise: UNLIMITED_BYTES,
};

/** Contexto de cuota resuelto: personal (tier de cuenta) u org (tier de la org). */
export type QuotaScope = { kind: "personal"; tier: AccountTier } | { kind: "org"; tier: OrganizationTier };

interface StorageAppMinMatrix {
	personal: Record<AccountTier, number>;
	org: Record<OrganizationTier, number>;
}

/**
 * Mínimo garantizado por app, contexto y tier: aunque la cuota total del
 * contexto esté agotada, cada app puede seguir consumiendo hasta su mínimo
 * para no romper funcionalidad básica. Son pisos de funcionalidad, no escalan
 * proporcional al límite total del tier.
 */
const STORAGE_APP_MIN_BYTES: Record<string, StorageAppMinMatrix> = {
	drive: {
		personal: { free: 50 * MB, pro: 250 * MB, plus: 1 * GB },
		org: { default: 50 * MB, team: 250 * MB, enterprise: 1 * GB },
	},
	email: {
		personal: { free: 100 * MB, pro: 500 * MB, plus: 2 * GB },
		org: { default: 100 * MB, team: 500 * MB, enterprise: 2 * GB },
	},
	community: {
		personal: { free: 50 * MB, pro: 250 * MB, plus: 1 * GB },
		org: { default: 50 * MB, team: 250 * MB, enterprise: 1 * GB },
	},
	"project-manager": {
		personal: { free: 100 * MB, pro: 500 * MB, plus: 2 * GB },
		org: { default: 100 * MB, team: 500 * MB, enterprise: 2 * GB },
	},
	// Los avatares cuentan SIEMPRE en contexto personal (en org quedan en 0).
	avatars: {
		personal: { free: 10 * MB, pro: 20 * MB, plus: 50 * MB },
		org: { default: 0, team: 0, enterprise: 0 },
	},
};

/** Mínimo garantizado de una app para un contexto; app no listada → 0. */
export function getStorageAppMinBytes(appId: string, scope: QuotaScope): number {
	const matrix = STORAGE_APP_MIN_BYTES[appId];
	if (!matrix) return 0;
	return scope.kind === "personal" ? (matrix.personal[scope.tier] ?? matrix.personal.free) : (matrix.org[scope.tier] ?? matrix.org.default);
}

/**
 * Tope default de almacenamiento por miembro de una org sin override propio:
 * evita que un solo usuario consuma el pool completo. `UNLIMITED_BYTES` = sin
 * tope por miembro (cae al límite de la org). Ajustable por organización vía
 * override `org-members-default`.
 */
const ORG_MEMBER_DEFAULT_BYTES: Record<OrganizationTier, number> = {
	default: 512 * MB, // pool 1 GB
	team: 10 * GB, // pool 50 GB
	enterprise: UNLIMITED_BYTES,
};

export function getOrgMemberDefaultBytes(tier: OrganizationTier = "default"): number {
	return ORG_MEMBER_DEFAULT_BYTES[tier] ?? ORG_MEMBER_DEFAULT_BYTES.default;
}
