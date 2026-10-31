export const SUMI_RESOURCE_NAME = "sumi" as const;

/**
 * Scopes del recurso `sumi` (bitfield). Se traducen al rol que Sumi entiende:
 * CHAT → USER, TRUSTED → TRUSTED (sus aportes cuentan como fuente confiable), ADMIN → ADMIN.
 */
export const SumiScopes = {
	NONE: 0,
	CHAT: 1,
	TRUSTED: 1 << 1,
	ADMIN: 1 << 2,
	ALL: 1 | (1 << 1) | (1 << 2),
} as const;
