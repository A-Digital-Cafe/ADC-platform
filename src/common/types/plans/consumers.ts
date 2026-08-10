/**
 * Helpers que usan los **consumidores** del motor de planes.
 *
 * Viven en `@common` y no en el módulo de `PlanService`: importarlos desde el servicio arrastraría
 * el grafo del kernel (`@kernel`, `@adc/*`) a cualquier tsconfig que los toque, y las apps no
 * tienen esos aliases. Todos degradan a "no disponible" en vez de lanzar (fail-open).
 */

import type { Capability } from "../../security/Capability.js";
import type { IPlanService } from "./IPlanService.js";
import type { EntitlementsDTO, EntitlementsGetter, FeatureDef, FeatureValue, ModulePlanDefaults, PlanSubject } from "./index.js";

/**
 * Resolver perezoso de `PlanService`. El consumer lo provee resolviendo su
 * **dependencia declarada** (`this.tryGetMyService("PlanService")`), de modo que estos
 * helpers no necesitan acceso crudo al kernel.
 */
export type PlanResolver = () => IPlanService | undefined;

/** Getter lazy de entitlements: `null` si el servicio no está cargado. */
export function createEntitlementsGetter(resolvePlans: PlanResolver): EntitlementsGetter {
	return () => {
		try {
			return resolvePlans()?.entitlements ?? null;
		} catch {
			return null;
		}
	};
}

/**
 * Consulta de asientos para el gate de altas de miembros. Devuelve `null` si el
 * servicio no está cargado, para que el caller **no bloquee** el alta (fail-open).
 */
export type SeatGate = (orgId: string) => Promise<{ paidSeats: number; activeSeats: number } | null>;

/** Getter lazy del gate de asientos, para consumers que cargan antes que `PlanService`. */
export function createSeatGate(resolvePlans: PlanResolver): SeatGate {
	return async (orgId: string) => {
		try {
			return (await resolvePlans()?.seats(orgId)) ?? null;
		} catch {
			return null;
		}
	};
}

/**
 * Lectura del snapshot de entitlements de un sujeto, ya degradada: `null` si `PlanService`
 * no está cargado o si la consulta falla.
 *
 * Vive acá y no en el módulo de `PlanService` por lo mismo que el resto del archivo: importar
 * desde el servicio arrastraría el grafo del kernel a cualquier tsconfig que lo toque.
 */
type EntitlementsReader = (subject: PlanSubject) => Promise<EntitlementsDTO | null>;

/** @public Construye un {@link EntitlementsReader} a partir del getter lazy del consumidor. */
export function createEntitlementsReader(getEntitlements: EntitlementsGetter): EntitlementsReader {
	return async (subject) => {
		const entitlements = getEntitlements();
		if (!entitlements) return null;
		try {
			return await entitlements.get(subject);
		} catch {
			return null;
		}
	};
}

/**
 * Valor numérico de una feature; `fallback` si no está o no es numérico.
 *
 * **No interpreta el centinela de "ilimitado"** a propósito: `resolveFeatureValue` deja pasar
 * el `-1` tal cual y hoy cada consumidor lo compara como un límite normal. Mapearlo a
 * `Infinity` acá convertiría "bloquea nada" en "sin límite" para drive, project-manager y
 * email de un plumazo.
 * @public
 */
export function featureNumber(value: FeatureValue | undefined, fallback: number): number {
	return typeof value === "number" ? value : fallback;
}

/** @public Valor de una feature de tipo `enum`; `fallback` si no está o no es string. */
export function featureString<T extends string>(value: FeatureValue | undefined, fallback: T): T {
	return typeof value === "string" ? (value as T) : fallback;
}

/**
 * Declara las features de un módulo (y sus defaults de plan) si el servicio está
 * disponible; `false` si no lo está. Fail-open: el módulo sigue funcionando con
 * su fallback local y puede reintentar en `onDependencyRestored("PlanService")`.
 */
export async function registerPlanFeatures(
	resolvePlans: PlanResolver,
	token: Capability,
	features: readonly FeatureDef[],
	defaults?: ModulePlanDefaults
): Promise<boolean> {
	try {
		const plans = resolvePlans();
		if (!plans) return false;
		await plans.registerFeatures(token, features, defaults);
		return true;
	} catch {
		return false;
	}
}
