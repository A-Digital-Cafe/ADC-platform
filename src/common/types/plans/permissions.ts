export const PLANS_RESOURCE_NAME = "plans" as const;

/**
 * Scopes del recurso `plans` (bitfield). Recurso `globalOnly`: administrar la
 * oferta comercial es competencia de la plataforma, no de cada organización.
 *
 * - `CATALOG`: definiciones de planes y features (la oferta).
 * - `OVERRIDES`: excepciones por usuario/rol/organización.
 * - `SUBSCRIPTIONS`: suscripciones y asientos pagos.
 */
export const PlanScopes = {
	NONE: 0,
	CATALOG: 1, // 1
	OVERRIDES: 1 << 1, // 2
	SUBSCRIPTIONS: 1 << 2, // 4
	ALL: 1 | (1 << 1) | (1 << 2), // 7
} as const;
