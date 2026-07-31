import { resolveFeatureValue, type FeatureValue, type OrgPlanSnapshot } from "@common/types/plans/index.ts";
import { EXPANSION_FEATURE, SEATS_FEATURE } from "../domain/index.ts";
import type { PlanCatalog } from "./PlanCatalog.ts";
import type { OverrideResolver } from "./OverrideResolver.ts";
import { applyOverrides, clampTo } from "./shared.ts";

/**
 * Lo que una organización tiene **como tal**: el pool compartido y el tope por
 * miembro que se deriva del plan.
 *
 * El `org.seats` se resuelve primero a propósito: es el driver del escalado
 * `base + perSeat × paidSeats` del resto de las features, así que escalarlo con
 * sí mismo sería recursivo.
 */
export class OrgLevelResolver {
	readonly #catalog: PlanCatalog;
	readonly #overrides: OverrideResolver;

	constructor(catalog: PlanCatalog, overrides: OverrideResolver) {
		this.#catalog = catalog;
		this.#overrides = overrides;
	}

	/** Valores a nivel organización: plan escalado por asientos + ampliación + overrides de la org. */
	async level(orgId: string, tier: string): Promise<Omit<OrgPlanSnapshot, "orgId" | "tier">> {
		const plan = await this.#catalog.getPlan("org", tier);
		const planFeatures = plan?.features ?? {};
		const orgOverrides = await this.#overrides.resolveForOrg(orgId);
		const paidSeats = await this.paidSeats(orgId, tier, orgOverrides, planFeatures[SEATS_FEATURE]);

		// La ampliación reemplaza valores del plan; los overrides de la org tienen la última palabra.
		const expansion = plan?.expansionFeatures;
		const expanded = orgOverrides.get(EXPANSION_FEATURE) === true && expansion !== undefined;
		const effectivePlan = expanded ? { ...planFeatures, ...expansion } : planFeatures;

		const values: Record<string, FeatureValue> = {};
		for (const [key, raw] of Object.entries(effectivePlan)) values[key] = resolveFeatureValue(raw, paidSeats);
		applyOverrides(values, orgOverrides, null);
		values[SEATS_FEATURE] = paidSeats;

		// Tope por miembro sin override propio; `UNLIMITED` = sin tope, o sea el de la org.
		const memberPlanDefaults: Record<string, FeatureValue> = {};
		for (const [key, raw] of Object.entries(plan?.memberFeatures ?? {})) {
			memberPlanDefaults[key] = clampTo(resolveFeatureValue(raw, paidSeats), values[key]);
		}
		// Un `org-members-default` administrado pisa el valor del plan.
		const memberDefaultOverrides = Object.fromEntries(await this.#overrides.resolveMembersDefault(orgId));
		const memberDefaults = { ...memberPlanDefaults };
		for (const [key, value] of Object.entries(memberDefaultOverrides)) memberDefaults[key] = clampTo(value, values[key]);

		return { values, paidSeats, expanded, memberDefaults, memberPlanDefaults, memberDefaultOverrides };
	}

	/**
	 * Asientos pagos: override de la org (lo que escribe una compra) o, si no hay,
	 * el valor del plan / `includedSeats`. Siempre plano.
	 */
	async paidSeats(orgId: string, tier: string, orgOverrides?: Map<string, FeatureValue>, planSeats?: unknown): Promise<number> {
		const overrides = orgOverrides ?? (await this.#overrides.resolveForOrg(orgId));
		const fromOverride = overrides.get(SEATS_FEATURE);
		if (typeof fromOverride === "number") return fromOverride;

		const raw = planSeats ?? (await this.#catalog.rawValue("org", tier, SEATS_FEATURE));
		if (raw !== undefined) {
			const value = resolveFeatureValue(raw as never);
			if (typeof value === "number") return value;
		}
		const plan = await this.#catalog.getPlan("org", tier);
		return plan?.includedSeats ?? 0;
	}
}
