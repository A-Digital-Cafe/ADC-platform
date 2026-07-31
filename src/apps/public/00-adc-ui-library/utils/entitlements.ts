/**
 * Entitlements compartidos — helper para microfrontends que necesitan saber qué
 * puede usar la persona autenticada (límites del plan y consumo actual) sin
 * depender del app de suscripciones.
 *
 * Mismo contrato que `session.ts`: cache de 30 s y deduplicación de peticiones en vuelo.
 *
 * **El gating de la UI es feedback, no seguridad**: la autoridad es el backend, que revalida el
 * límite en su DAO. Acá sólo se decide si un botón se ve deshabilitado o aparece un aviso de plan.
 */

import { createAdcApi } from "./adc-fetch.js";
import { isUnlimited, remaining, type EntitlementsDTO, type FeatureValue, type MeterWindow } from "@common/types/plans/index.js";

export type { EntitlementsDTO, FeatureValue };

const api = createAdcApi({ basePath: "/api/plans", devPort: 3000 });

const CACHE_TTL_MS = 30_000;
let cache: { data: EntitlementsDTO | null; ts: number } | null = null;
let inflight: Promise<EntitlementsDTO | null> | null = null;

/** Entitlements del usuario actual; `null` si no hay sesión o el servicio no responde. */
export async function getEntitlements(force = false, silent = true): Promise<EntitlementsDTO | null> {
	const now = Date.now();
	if (!force && cache && now - cache.ts < CACHE_TTL_MS) return cache.data;
	if (inflight !== null) return inflight;

	inflight = (async () => {
		const result = await api.get<EntitlementsDTO>("/me", { silent });
		const data = result.success && result.data ? result.data : null;
		cache = { data, ts: Date.now() };
		return data;
	})();

	try {
		return await inflight;
	} finally {
		inflight = null;
	}
}

/** Descarta la cache (tras contratar un plan o cambiar de contexto de organización). */
export function invalidateEntitlements(): void {
	cache = null;
}

/** Valor efectivo de una feature. `undefined` si no está en el plan. */
export function featureValue(entitlements: EntitlementsDTO | null, key: string): FeatureValue | undefined {
	return entitlements?.features[key];
}

/** `true` si una feature de tipo flag está activa. */
export function hasFeature(entitlements: EntitlementsDTO | null, key: string): boolean {
	return entitlements?.features[key] === true;
}

/** Consumo actual de una feature medida, en la ventana pedida. */
export function usedOf(entitlements: EntitlementsDTO | null, key: string, window: MeterWindow = "month"): number {
	return entitlements?.usage[key]?.[window] ?? 0;
}

/**
 * Unidades restantes de una feature medida (`Infinity` si es ilimitada).
 *
 * Sin entitlements devuelve `Infinity`: no conocer el límite no es razón para
 * bloquear la UI — el backend rechazará si corresponde.
 */
export function remainingOf(entitlements: EntitlementsDTO | null, key: string, window: MeterWindow = "month"): number {
	const limit = entitlements?.features[key];
	if (typeof limit !== "number") return Number.POSITIVE_INFINITY;
	return remaining(limit, usedOf(entitlements, key, window));
}

/** `true` si consumir `amount` de una feature medida excedería su límite. */
export function wouldExceed(entitlements: EntitlementsDTO | null, key: string, amount = 1, window: MeterWindow = "month"): boolean {
	const limit = entitlements?.features[key];
	if (typeof limit !== "number" || isUnlimited(limit)) return false;
	return usedOf(entitlements, key, window) + amount > limit;
}
