import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import { EXPANSION_FEATURE, SEATS_FEATURE } from "../domain/index.ts";
import type { OverridesManager } from "./OverridesManager.ts";

/** Descarta las caches de resolución tras un cambio comercial. */
export type InvalidateCaches = (orgId?: string) => void;

/**
 * Operaciones comerciales sobre una organización: asientos pagos y ampliación.
 *
 * Las dos se modelan como **overrides** y no como mecanismos aparte: comprar
 * asientos es escribir `org.seats` sobre el sujeto `org` (y todo lo que escala
 * `perSeat` se recalcula solo), y la ampliación es un flag booleano revocable que
 * no toca la suscripción ni la facturación.
 */
export class OrgPlanAdmin {
	readonly #overrides: OverridesManager;
	readonly #invalidate: InvalidateCaches;

	constructor(overrides: OverridesManager, invalidate: InvalidateCaches) {
		this.#overrides = overrides;
		this.#invalidate = invalidate;
	}

	/** Otorga o revoca la ampliación. Revocarla borra el override y devuelve los límites base. */
	async setExpansion(orgId: string, granted: boolean, actorUserId: string): Promise<void> {
		const actor = { userId: actorUserId, orgId: null };
		if (granted) {
			await this.#overrides.upsert(actor, { subjectType: "org", subjectId: orgId, featureKey: EXPANSION_FEATURE, value: true });
		} else {
			await this.#overrides.removeByFeature("org", orgId, EXPANSION_FEATURE);
		}
		this.#invalidate(orgId);
	}

	/** Fija los asientos pagos de una organización (lo que hace una compra). */
	async setSeats(orgId: string, seats: number, actorUserId: string): Promise<void> {
		if (!Number.isInteger(seats) || seats < 1) {
			throw new PlanError(400, "INVALID_FIELD", "`seats` debe ser un entero ≥ 1");
		}
		await this.#overrides.upsert(
			{ userId: actorUserId, orgId: null },
			{ subjectType: "org", subjectId: orgId, featureKey: SEATS_FEATURE, value: seats }
		);
		this.#invalidate(orgId);
	}
}
