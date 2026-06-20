/**
 * Tier de la cuenta (usuario u organización). Concepto transversal a toda la
 * plataforma — distintos servicios (PM, storage, email, etc.) consumen este tier
 * para derivar sus propios límites.
 *
 * El tier no viaja en el token: se resuelve desde `user.metadata.accountTier`
 * (default `free`).
 */

export type AccountTier = "free" | "pro" | "plus";

/** Tiers de cuenta personales en orden ascendente.
 * @public
 */
export const ACCOUNT_TIERS: readonly AccountTier[] = ["free", "pro", "plus"] as const;

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
