/**
 * Tier de la cuenta (usuario u organización). Concepto transversal a toda la
 * plataforma — distintos servicios (PM, storage, email, etc.) consumen este tier
 * para derivar sus propios límites.
 *
 * El tier no viaja en el token: se resuelve desde `user.metadata.accountTier`
 * (default `free`).
 */

export type AccountTier = "free" | "vip" | "pro" | "plus";

/** Tiers de cuenta personales en orden ascendente.
 * @public
 */
export const ACCOUNT_TIERS: readonly AccountTier[] = ["free", "vip", "pro", "plus"] as const;

/**
 * Tiers que NO se compran: se otorgan al cumplir una condición de comunidad.
 *
 * `vip` es el único hoy. Está entre `free` y `pro` a propósito: agradece la
 * participación en la comunidad sin canibalizar el plan pago más barato.
 * @public
 */
export const GRANTED_TIERS: readonly AccountTier[] = ["vip"] as const;

/**
 * Posición del tier en la escalera (0 = `free`). Sirve para comparar sin
 * escribir la cadena `free < vip < pro < plus` en cada consumidor.
 * @public
 */
export function tierRank(tier: AccountTier): number {
	const index = ACCOUNT_TIERS.indexOf(tier);
	// Un tier desconocido (dato viejo en la base) vale lo mismo que `free`: nunca
	// se le da de más a algo que no sabemos leer.
	return index === -1 ? 0 : index;
}

/**
 * El mayor de dos tiers. Es lo que hace que un plan pago siempre gane: un `vip`
 * otorgado por comunidad no puede degradar a quien ya paga `pro` o `plus`.
 * @public
 */
export function maxTier(a: AccountTier, b: AccountTier): AccountTier {
	return tierRank(a) >= tierRank(b) ? a : b;
}

/**
 * Grant temporal de tier (recompensa de bug bounty u otros beneficios acotados).
 * Se persiste en `user.metadata.tierGrant` junto con `metadata.accountTier = tier`.
 * Un cron (IdentityManagerService) revierte a `previousTier` cuando `expiresAt <= now`.
 * Como todos los resolvers leen `metadata.accountTier`, no necesitan conocer el grant.
 * @public
 */
export interface TierGrant {
	/** Tier otorgado mientras el grant esté vigente. */
	tier: AccountTier;
	/** Tier al que se revierte al expirar (el que tenía el usuario al otorgarse). */
	previousTier: AccountTier;
	/** ISO-8601 del otorgamiento. */
	grantedAt: string;
	/** ISO-8601 de expiración; el cron revierte cuando se supera. */
	expiresAt: string;
	/** Motivo/trazabilidad, ej. `bug-bounty:STATUS-123`. */
	reason?: string;
}

/** Devuelve true si el grant sigue vigente respecto a `now`. */
export function isTierGrantActive(grant: TierGrant | null | undefined, now: Date = new Date()): boolean {
	if (!grant) return false;
	return new Date(grant.expiresAt).getTime() > now.getTime();
}
