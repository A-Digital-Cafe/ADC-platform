import { resolveFeatureValue, type FeatureValue, type OrgPlanSnapshot, type PlanAxis, type PlanSubject } from "@common/types/plans/index.ts";
import type { PlanCatalog } from "./PlanCatalog.ts";
import type { TierResolver } from "./TierResolver.ts";
import type { SeatCounter } from "./SeatCounter.ts";
import type { OverrideResolver } from "./OverrideResolver.ts";
import type { OrgLevelResolver } from "./OrgLevelResolver.ts";
import { applyOverrides } from "./shared.ts";

/** Lo que un sujeto tiene resuelto, antes de mirar consumo. */
export interface ResolvedFeatures {
	axis: PlanAxis;
	tier: string;
	features: Record<string, FeatureValue>;
	paidSeats?: number;
	activeSeats?: number;
}

/**
 * Resuelve los **valores efectivos** de un sujeto: tier → plan → escalado por
 * asientos → ampliación → overrides.
 *
 * En el eje organización, el pool compartido lo calcula `OrgLevelResolver`; acá se
 * baja de la organización al miembro: sus overrides (usuario → roles →
 * `org-members-default`) se aplican **clampeados** al valor de la org, así que
 * bajar el plan de una org degrada automáticamente lo ya asignado adentro.
 */
export class PlanResolver {
	readonly #catalog: PlanCatalog;
	readonly #tiers: TierResolver;
	readonly #seats: SeatCounter;
	readonly #overrides: OverrideResolver;
	readonly #orgLevel: OrgLevelResolver;

	constructor(catalog: PlanCatalog, tiers: TierResolver, seats: SeatCounter, overrides: OverrideResolver, orgLevel: OrgLevelResolver) {
		this.#catalog = catalog;
		this.#tiers = tiers;
		this.#seats = seats;
		this.#overrides = overrides;
		this.#orgLevel = orgLevel;
	}

	/** Valores efectivos del sujeto en su eje. */
	async resolve(subject: PlanSubject): Promise<ResolvedFeatures> {
		const { axis, tier } = await this.#tiers.resolve(subject);

		if (axis === "user") {
			const plan = await this.#catalog.getPlan(axis, tier);
			const features: Record<string, FeatureValue> = {};
			for (const [key, raw] of Object.entries(plan?.features ?? {})) features[key] = resolveFeatureValue(raw);
			applyOverrides(features, await this.#overrides.resolveForSubject(subject.userId, null), null);
			return { axis, tier, features };
		}

		const orgId = subject.orgId as string;
		const { values: orgValues, paidSeats, memberDefaults } = await this.#orgLevel.level(orgId, tier);

		// Valores del miembro dentro de esa organización, nunca por encima de la org:
		// arranca en el tope por miembro del plan y sus overrides propios lo pisan.
		const features = { ...orgValues, ...memberDefaults };
		applyOverrides(features, await this.#overrides.resolveForSubject(subject.userId, orgId), orgValues);

		const activeSeats = await this.#seats.activeSeats(orgId);
		return { axis, tier, features, paidSeats, activeSeats };
	}

	/**
	 * Vista de la organización como tal. La consume `StorageQuotaService` para su
	 * panel de límites, que dejó de tener resolución propia.
	 */
	async orgSnapshot(orgId: string): Promise<OrgPlanSnapshot> {
		const tier = await this.#tiers.orgTier(orgId);
		return { orgId, tier, ...(await this.#orgLevel.level(orgId, tier)) };
	}

	/**
	 * Asientos pagos y ocupados. Alimenta el panel de asientos y el **gate de altas**,
	 * por eso el conteo de ocupados se lee sin cache.
	 *
	 * Queda una ventana TOCTOU entre este conteo y el alta (dos altas concurrentes
	 * podrían pasar el tope por uno) — mismo compromiso que `checkAllowance` en las
	 * cuotas de storage; el ajuste lo hace la conciliación, no un lock por request.
	 */
	async seats(orgId: string): Promise<{ paidSeats: number; activeSeats: number }> {
		const tier = await this.#tiers.orgTier(orgId);
		const [paidSeats, activeSeats] = await Promise.all([this.#orgLevel.paidSeats(orgId, tier), this.#seats.activeSeats(orgId, true)]);
		return { paidSeats, activeSeats };
	}
}
