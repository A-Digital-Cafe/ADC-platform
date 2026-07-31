/**
 * Contrato público del **PlanService**.
 *
 * Vive en `@common` para que apps y servicios (incluidos presets) consuman el motor
 * de entitlements por **interfaz**, sin importar la clase concreta de `@services`.
 * Espejo de `IStorageQuotaService`.
 */

import type { Capability } from "../../security/Capability.js";
import type { EntitlementsProvider, FeatureDef, ModulePlanDefaults, OrgPlanSnapshot, PlanOverridesAdmin, PlanPrice } from "./index.js";

export interface IPlanService {
	/** Superficie estable que consumen los módulos (get/check/commit/release). */
	readonly entitlements: EntitlementsProvider;
	/**
	 * Administración de excepciones de límite.
	 *
	 * La expone el motor porque `plan_overrides` es la **única** colección de
	 * excepciones de la plataforma: un módulo con panel propio de límites (como el de
	 * almacenamiento) administra los suyos desde acá en vez de llevar los propios.
	 */
	readonly overridesAdmin: PlanOverridesAdmin;
	/** Lo que tiene asignado una organización como tal, y el tope por miembro que se deriva. */
	orgSnapshot(orgId: string): Promise<OrgPlanSnapshot>;
	/**
	 * Declara las features vendibles del módulo y, opcionalmente, sus valores
	 * default por tier. Requiere capability con scope `plans:register`.
	 *
	 * Los defaults se mergean en los planes existentes: sobre un plan no editado
	 * mandan los del módulo; sobre uno editado (o importado desde la oferta
	 * privada) sólo se agregan las claves que falten.
	 */
	registerFeatures(token: Capability, features: readonly FeatureDef[], defaults?: ModulePlanDefaults): Promise<void>;
	/** Asientos pagos y ocupados de una organización. */
	seats(orgId: string): Promise<{ paidSeats: number; activeSeats: number }>;
	/**
	 * Fija los asientos pagos de una organización (lo que hace una compra). Requiere
	 * capability con scope `plans:admin`. Internamente es un override de `org.seats`:
	 * los límites que escalan `perSeat` se recalculan solos.
	 */
	setOrgSeats(token: Capability, orgId: string, seats: number, actorUserId: string): Promise<void>;
	/**
	 * Rango de asientos contratable de un tier de organización, para validar antes de
	 * mandar a alguien a pagar. `null` si el tier no existe.
	 */
	seatBounds(tier: string): Promise<{ minSeats: number; maxSeats: number | null } | null>;
	/**
	 * Precio de lista de un plan (`<axis>:<tier>`). `null` si el plan no existe o no está a la venta
	 * (gratuito, o a medida como enterprise). Ver {@link PlanPrice}: es la única fuente del precio.
	 */
	planPrice(key: string): Promise<PlanPrice | null>;
	/**
	 * Otorga o revoca la **ampliación** de una organización. Requiere `plans:admin`.
	 *
	 * Es un override booleano, no un cambio de plan: revocarla devuelve los límites
	 * base sin tocar la suscripción ni la facturación.
	 */
	setOrgExpansion(token: Capability, orgId: string, granted: boolean, actorUserId: string): Promise<void>;
}
