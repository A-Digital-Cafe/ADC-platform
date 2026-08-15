import type { Model } from "mongoose";
import { planKey, type FeatureDef, type PlanAxis, type PlanDefinition, type PlanFeatureValue, type PlanPrice } from "@common/types/plans/index.ts";
import { ACCOUNT_TIERS } from "@common/types/tiers.ts";
import { ORGANIZATION_TIERS } from "@common/types/identity/Organization.ts";
import { SEED_FEATURES, type PlanDefinitionDoc } from "../domain/index.ts";

const CACHE_TTL_MS = 30_000;

/**
 * Catálogo de planes y features: el **lado de lectura** del motor.
 *
 * - **Features**: registro en memoria. Cada módulo declara las suyas al arrancar
 *   (`registerFeatures`), igual que `StorageQuotaService.registerApp`; el seed
 *   sólo aporta las de plataforma (`org.seats`, `storage.total`).
 * - **Planes**: colección `plan_definitions`, cacheada con TTL corto.
 *
 * Las escrituras viven en `PlanSeeder` (defaults del código) y `PlanWriter`
 * (administración y oferta importada); ambas invalidan esta cache al terminar.
 */
export class PlanCatalog {
	readonly #model: Model<PlanDefinitionDoc>;
	readonly #features = new Map<string, FeatureDef>();
	#plans: Map<string, PlanDefinition> | null = null;
	#plansExpireAt = 0;

	constructor(model: Model<PlanDefinitionDoc>) {
		this.#model = model;
		this.registerFeatures(SEED_FEATURES);
	}

	// ─── Features ────────────────────────────────────────────────────────────

	/** Alta/actualización idempotente de features. La última declaración gana. */
	registerFeatures(features: readonly FeatureDef[]): void {
		for (const f of features) {
			if (!f?.key) continue;
			this.#features.set(f.key, f);
		}
	}

	getFeature(key: string): FeatureDef | undefined {
		return this.#features.get(key);
	}

	listFeatures(): FeatureDef[] {
		return [...this.#features.values()];
	}

	// ─── Planes ──────────────────────────────────────────────────────────────

	/**
	 * Todos los planes, cacheados (TTL 30 s). La colección tiene un plan por eje/tier.
	 *
	 * Ordenados **de menor a mayor tier**, no por orden de inserción: la página de
	 * precios los pinta en este orden y un tier agregado después (como `vip`, que es
	 * intermedio) aparecería último, contando la escalera al revés.
	 */
	async listPlans(): Promise<PlanDefinition[]> {
		return [...(await this.#loadPlans()).values()].sort(comparePlans);
	}

	/** Plan de un eje/tier; `null` si no existe (el caller decide el fallback). */
	async getPlan(axis: PlanAxis, tier: string): Promise<PlanDefinition | null> {
		return (await this.#loadPlans()).get(planKey(axis, tier)) ?? null;
	}

	/** Valor crudo de una feature en un plan (sin resolver asientos ni overrides). */
	async rawValue(axis: PlanAxis, tier: string, featureKey: string): Promise<PlanFeatureValue | undefined> {
		const plan = await this.getPlan(axis, tier);
		return plan?.features[featureKey];
	}

	/**
	 * Precio de lista de un plan (`<axis>:<tier>`); `null` si el plan no existe o no está a la
	 * venta. Un importe en cero **no** es vendible (gratuito, o a medida como enterprise).
	 */
	async planPrice(key: string): Promise<PlanPrice | null> {
		const plan = (await this.#loadPlans()).get(key);
		if (!plan?.price || plan.price.unitAmountMinor <= 0) return null;
		return plan.price;
	}

	/** Rango de asientos contratable de un tier de organización; `null` si el tier no existe. */
	async seatBounds(tier: string): Promise<{ minSeats: number; maxSeats: number | null } | null> {
		const plan = await this.getPlan("org", tier);
		if (!plan) return null;
		return { minSeats: plan.minSeats ?? 1, maxSeats: plan.maxSeats ?? null };
	}

	/** Descarta la cache de planes (tras cualquier escritura). */
	invalidate(): void {
		this.#plans = null;
		this.#plansExpireAt = 0;
	}

	async #loadPlans(): Promise<Map<string, PlanDefinition>> {
		if (this.#plans && this.#plansExpireAt > Date.now()) return this.#plans;
		const docs = await this.#model.find().lean<PlanDefinitionDoc[]>();
		const map = new Map<string, PlanDefinition>();
		for (const d of docs) {
			map.set(d._id, {
				axis: d.axis,
				tier: d.tier,
				price: d.price,
				access: d.access,
				includedSeats: d.includedSeats,
				minSeats: d.minSeats,
				maxSeats: d.maxSeats,
				features: d.features ?? {},
				memberFeatures: d.memberFeatures,
				expansionFeatures: d.expansionFeatures,
			});
		}
		this.#plans = map;
		this.#plansExpireAt = Date.now() + CACHE_TTL_MS;
		return map;
	}
}

/** Orden de la escalera de planes: primero el eje personal, y dentro, de menor a mayor. */
function comparePlans(a: PlanDefinition, b: PlanDefinition): number {
	if (a.axis !== b.axis) return a.axis === "user" ? -1 : 1;
	const order: readonly string[] = a.axis === "user" ? ACCOUNT_TIERS : ORGANIZATION_TIERS;
	const ia = order.indexOf(a.tier);
	const ib = order.indexOf(b.tier);
	// Un tier que el código no conoce (dato viejo, o de un módulo que ya no está) va al
	// final en vez de colarse primero por un -1.
	return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
}
