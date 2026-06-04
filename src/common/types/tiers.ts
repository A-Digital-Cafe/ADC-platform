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
