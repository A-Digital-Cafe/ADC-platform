import type { EntitlementsProvider, PlanOverridesAdmin } from "@common/types/plans/index.ts";
import type { EntitlementsManager } from "./EntitlementsManager.ts";
import type { OverridesManager } from "./OverridesManager.ts";

/**
 * Adaptadores de manager → interfaz pública de `@common`.
 *
 * Existen para que los consumidores reciban exactamente el contrato declarado en
 * `IPlanService` y no la clase concreta: agregar un método al manager no amplía
 * por accidente lo que otros módulos pueden llamar.
 */

export function entitlementsProviderOf(manager: EntitlementsManager): EntitlementsProvider {
	return {
		get: (subject) => manager.get(subject),
		value: (subject, featureKey) => manager.value(subject, featureKey),
		check: (subject, featureKey, amount) => manager.check(subject, featureKey, amount),
		commit: (subject, featureKey, amount) => manager.commit(subject, featureKey, amount),
		release: (subject, featureKey, amount) => manager.release(subject, featureKey, amount),
	};
}

export function overridesAdminOf(overrides: OverridesManager): PlanOverridesAdmin {
	return {
		list: (actor, query) => overrides.list(actor, query),
		upsert: (actor, input) => overrides.upsert(actor, input),
		remove: (actor, overrideId) => overrides.remove(actor, overrideId),
	};
}
