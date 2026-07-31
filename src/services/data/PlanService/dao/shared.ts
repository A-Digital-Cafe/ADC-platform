/**
 * Helpers puros compartidos por los managers del motor de planes.
 *
 * Nada de acá toca la base ni el estado de un manager: son transformaciones sobre
 * mapas de features. Lo específico de un solo recurso vive en su propio archivo.
 */

import { planKey, UNLIMITED, type FeatureValue, type ModulePlanDefaults, type PlanAxis, type PlanFeatureValue } from "@common/types/plans/index.ts";
import { SEATS_FEATURE } from "../domain/index.ts";

type Features = Record<string, PlanFeatureValue> | undefined;

/**
 * Merge por clave de un mapa de features. `authoritative` decide quién manda
 * ante una clave repetida: `true` = el entrante (plan no editado: el código es
 * el dueño); `false` = el existente (plan editado/importado: sólo se agregan
 * claves nuevas).
 */
export function mergeFeatures(existing: Features, incoming: Features, authoritative: boolean): Record<string, PlanFeatureValue> {
	if (authoritative) return { ...existing, ...incoming };
	return { ...incoming, ...existing };
}

/** Como `mergeFeatures`, pero preserva el `undefined` cuando ninguno de los dos lados aporta nada. */
export function mergeOptionalFeatures(existing: Features, incoming: Features, authoritative: boolean): Features {
	if (!existing && !incoming) return undefined;
	return mergeFeatures(existing, incoming, authoritative);
}

/** Defaults de un módulo, ya agrupados por el plan al que aplican. */
export interface PendingPlanDefaults {
	axis: PlanAxis;
	tier: string;
	features?: Record<string, PlanFeatureValue>;
	memberFeatures?: Record<string, PlanFeatureValue>;
	expansionFeatures?: Record<string, PlanFeatureValue>;
}

/**
 * Agrupa los cuatro mapas de `ModulePlanDefaults` (user/org/orgMember/expansion)
 * por plan destino, para escribir cada plan una sola vez.
 */
export function pendingPlansFrom(defaults: ModulePlanDefaults): Map<string, PendingPlanDefaults> {
	const byPlan = new Map<string, PendingPlanDefaults>();
	const pendingFor = (axis: PlanAxis, tier: string): PendingPlanDefaults => {
		const key = planKey(axis, tier);
		let entry = byPlan.get(key);
		if (!entry) {
			entry = { axis, tier };
			byPlan.set(key, entry);
		}
		return entry;
	};

	for (const [tier, features] of Object.entries(defaults.user ?? {})) pendingFor("user", tier).features = features;
	for (const [tier, features] of Object.entries(defaults.org ?? {})) pendingFor("org", tier).features = features;
	for (const [tier, features] of Object.entries(defaults.orgMember ?? {})) pendingFor("org", tier).memberFeatures = features;
	for (const [tier, features] of Object.entries(defaults.expansion ?? {})) pendingFor("org", tier).expansionFeatures = features;
	return byPlan;
}

/**
 * Aplica overrides sobre los valores ya resueltos. Con `ceiling` presente (contexto
 * org) los numéricos se clampean al valor de la organización.
 */
export function applyOverrides(
	target: Record<string, FeatureValue>,
	overrides: Map<string, FeatureValue>,
	ceiling: Record<string, FeatureValue> | null
): void {
	for (const [key, value] of overrides) {
		if (key === SEATS_FEATURE && ceiling) continue; // los asientos no se overridean por miembro
		target[key] = ceiling ? clampTo(value, ceiling[key]) : value;
	}
}

/** Clampea un valor numérico al techo de la organización. No numéricos pasan tal cual. */
export function clampTo(value: FeatureValue, ceiling: FeatureValue | undefined): FeatureValue {
	if (typeof value !== "number" || typeof ceiling !== "number") return value;
	if (ceiling === UNLIMITED) return value;
	if (value === UNLIMITED) return ceiling;
	return Math.min(value, ceiling);
}
