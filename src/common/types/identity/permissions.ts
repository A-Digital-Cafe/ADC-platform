export const RESOURCE_NAME = "identity" as const;

// Scope (bitfield)

/**
 * Áreas de alcance en el sistema de identidad (bitfield).
 * Permite combinaciones: USERS | GROUPS = 10
 */
export const IdentityScopes = {
	NONE: 0,
	SELF: 1, // 1
	USERS: 1 << 1, // 2
	ROLES: 1 << 2, // 4
	GROUPS: 1 << 3, // 8
	ORGANIZATIONS: 1 << 4, // 16
	REGIONS: 1 << 5, // 32
	STATS: 1 << 6, // 64
	ALL: 1 | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6), // 127
} as const;
