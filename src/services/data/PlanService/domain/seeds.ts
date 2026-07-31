/**
 * Seed de **plataforma** del catálogo: crea los shells de plan por tier y las
 * features que no pertenecen a ningún módulo (`org.seats`, `storage.total`).
 *
 * Las features de cada módulo no viven acá: cada servicio las declara con `registerFeatures()` al
 * arrancar y `PlanCatalog.applyModuleDefaults` las mergea sobre estos shells, así que un preset
 * ausente simplemente no aporta las suyas.
 *
 * Los valores son **defaults de desarrollo** (los de `free`/`default` son además el piso real de
 * la plataforma); la oferta comercial se publica con `PUT /api/plans/admin/plans`. El eje org entra
 * siempre como `{ base, perSeat: 0 }`: el `perSeat` es una decisión comercial posterior.
 */

import { ACCOUNT_TIERS, type AccountTier } from "@common/types/tiers.ts";
import { ORGANIZATION_TIERS, type OrganizationTier } from "@common/types/identity/Organization.ts";
import { STORAGE_USER_TIER_LIMITS, STORAGE_ORG_TIER_LIMITS, STORAGE_TOTAL_FEATURE, getOrgMemberDefaultBytes } from "@common/types/tiers/storage.ts";
import type { FeatureDef, PlanDefinition, PlanFeatureValue } from "@common/types/plans/index.ts";
import { SEATS_FEATURE } from "./features.ts";

/**
 * Asientos por tier de organización.
 *
 * - `included`: los que hay sin suscripción activa. Es también el **tope de miembros**
 *   y el driver del escalado `perSeat`.
 * - `min`/`max`: el rango contratable. `team` arranca en 4 para que sea un plan de
 *   grupo y no de una persona sola, y se corta en 8 porque a partir de ahí conviene
 *   `enterprise`, que se arma a medida.
 *
 * Son valores comerciales: los reales se publican con `push` o se ajustan desde el panel.
 */
const ORG_SEATS: Record<OrganizationTier, { included: number; min?: number; max?: number }> = {
	default: { included: 3, min: 1, max: 3 },
	team: { included: 4, min: 4, max: 8 },
	enterprise: { included: 10, min: 10 },
};

/** Features de plataforma: las únicas que no declara ningún módulo. */
export const SEED_FEATURES: FeatureDef[] = [
	{ key: SEATS_FEATURE, module: "platform", label: "plans.features.org.seats", kind: "limit", unit: "count", salesVisible: true },
	{
		key: STORAGE_TOTAL_FEATURE,
		module: "platform",
		label: "plans.features.storage.total",
		kind: "limit",
		unit: "bytes",
		salesVisible: true,
		orgScaling: "perSeat",
	},
];

/** Features del eje personal para un tier de cuenta. */
function userFeatures(tier: AccountTier): Record<string, PlanFeatureValue> {
	return { [STORAGE_TOTAL_FEATURE]: STORAGE_USER_TIER_LIMITS[tier] };
}

/** Features del eje organización. Cada valor entra plano (`perSeat: 0`) para no cambiar el comportamiento actual. */
function orgFeatures(tier: OrganizationTier): Record<string, PlanFeatureValue> {
	return {
		[SEATS_FEATURE]: ORG_SEATS[tier].included,
		[STORAGE_TOTAL_FEATURE]: { base: STORAGE_ORG_TIER_LIMITS[tier], perSeat: 0 },
	};
}

/**
 * Tope por miembro dentro de una organización, cuando no tiene override propio.
 *
 * Es lo que impide que una sola persona vacíe el pool compartido. Sale de
 * `ORG_MEMBER_DEFAULT_BYTES`, que antes vivía sólo en el resolver de storage; acá
 * pasa a ser un valor de plan más, editable desde el panel y aplicable a cualquier
 * feature, no sólo a bytes.
 */
function orgMemberFeatures(tier: OrganizationTier): Record<string, PlanFeatureValue> {
	return { [STORAGE_TOTAL_FEATURE]: getOrgMemberDefaultBytes(tier) };
}

/**
 * Ampliación de los pools compartidos.
 *
 * Sólo aplica a `team`. Acá entra únicamente la parte de plataforma (storage);
 * cada módulo con pool ampliable (correo, PM) aporta la suya en sus defaults de
 * registro, y la oferta importada define los valores reales.
 */
function expansionFeatures(tier: OrganizationTier): Record<string, PlanFeatureValue> | undefined {
	if (tier !== "team") return undefined;
	return { [STORAGE_TOTAL_FEATURE]: { base: 8 * STORAGE_USER_TIER_LIMITS.pro, perSeat: 0 } };
}

/** Los planes iniciales de ambos ejes. */
export function seedPlans(): PlanDefinition[] {
	const users = ACCOUNT_TIERS.map<PlanDefinition>((tier) => ({ axis: "user", tier, features: userFeatures(tier) }));
	const orgs = ORGANIZATION_TIERS.map<PlanDefinition>((tier) => ({
		axis: "org",
		tier,
		includedSeats: ORG_SEATS[tier].included,
		minSeats: ORG_SEATS[tier].min,
		maxSeats: ORG_SEATS[tier].max,
		features: orgFeatures(tier),
		memberFeatures: orgMemberFeatures(tier),
		expansionFeatures: expansionFeatures(tier),
	}));
	return [...users, ...orgs];
}
