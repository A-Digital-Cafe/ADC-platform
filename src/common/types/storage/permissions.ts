export const STORAGE_RESOURCE_NAME = "storage" as const;

/**
 * Scopes del recurso `storage` (bitfield).
 *
 * - `USAGE`: lectura/administración de contadores de uso (incluye reconcile).
 * - `LIMITS`: administración de overrides de límites.
 */
export const StorageScopes = {
	NONE: 0,
	USAGE: 1, // 1
	LIMITS: 1 << 1, // 2
	ALL: 1 | (1 << 1), // 3
} as const;
