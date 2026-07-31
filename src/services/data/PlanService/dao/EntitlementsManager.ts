import {
	remaining as remainingOf,
	UNLIMITED,
	type EntitlementsDTO,
	type FeatureValue,
	type OrgPlanSnapshot,
	type PlanCheckResult,
	type PlanDenyReason,
	type PlanSubject,
} from "@common/types/plans/index.ts";
import { SEATS_FEATURE } from "../domain/index.ts";
import type { PlanCatalog } from "./PlanCatalog.ts";
import type { PlanResolver } from "./PlanResolver.ts";
import type { UsageManager } from "./UsageManager.ts";

/**
 * Superficie de entitlements que consumen los módulos: qué puede usar un sujeto y
 * cuánto lleva usado.
 *
 * La resolución de valores (tier, plan, asientos, overrides) vive en `PlanResolver`;
 * acá queda el contrato de negocio: comprobar, consumir y devolver consumo.
 */
export class EntitlementsManager {
	readonly #catalog: PlanCatalog;
	readonly #resolver: PlanResolver;
	readonly #usage: UsageManager;

	constructor(catalog: PlanCatalog, resolver: PlanResolver, usage: UsageManager) {
		this.#catalog = catalog;
		this.#resolver = resolver;
		this.#usage = usage;
	}

	/** Snapshot completo: lo que consume `/api/plans/me` y la UI. */
	async get(subject: PlanSubject): Promise<EntitlementsDTO> {
		const { axis, tier, features, paidSeats, activeSeats } = await this.#resolver.resolve(subject);

		// Sólo se mide consumo de las features `quota`: el resto son topes instantáneos.
		const metered = this.#catalog
			.listFeatures()
			.filter((f) => f.kind === "quota" && features[f.key] !== undefined)
			.map((f) => f.key);
		const usage = await this.#usage.snapshotMany(subject, metered);

		return { subject, axis, tier, paidSeats, activeSeats, features, usage };
	}

	/** Valor efectivo de una única feature. */
	async value(subject: PlanSubject, featureKey: string): Promise<FeatureValue | undefined> {
		const { features } = await this.#resolver.resolve(subject);
		return features[featureKey];
	}

	/**
	 * Comprobación previa, sin consumir.
	 *
	 * - `quota` → compara el consumo de su ventana contra el límite.
	 * - `limit` → tope instantáneo: `PlanService` no conoce el conteo actual (vive en
	 *   la base del módulo), así que el caller pasa en `amount` el valor **resultante**
	 *   que quiere validar (ej. "voy a tener 4 proyectos").
	 * - `flag` → permitido si la feature está activa.
	 * - `enum` → informativo: devuelve el valor y no deniega.
	 */
	async check(subject: PlanSubject, featureKey: string, amount = 1): Promise<PlanCheckResult> {
		const def = this.#catalog.getFeature(featureKey);
		const limit = await this.value(subject, featureKey);

		if (limit === undefined) {
			return { allowed: false, limit: 0, used: 0, remaining: 0, reason: "NOT_IN_PLAN" };
		}
		if (!def || def.kind === "enum") {
			return { allowed: true, limit, used: 0, remaining: Number.POSITIVE_INFINITY };
		}
		if (def.kind === "flag") {
			return { allowed: limit === true, limit, used: 0, remaining: 0, reason: limit === true ? undefined : "TIER_LIMIT_REACHED" };
		}
		// Sin número no hay tope que comparar (y `UNLIMITED` es el tope explícitamente ausente).
		if (typeof limit !== "number" || limit === UNLIMITED) {
			return { allowed: true, limit, used: 0, remaining: Number.POSITIVE_INFINITY };
		}
		if (def.kind === "limit") {
			return {
				allowed: amount <= limit,
				limit,
				used: amount,
				remaining: remainingOf(limit, amount),
				reason: amount <= limit ? undefined : limitReason(featureKey),
			};
		}

		const window = def.window ?? "month";
		const used = (await this.#usage.snapshot(subject, featureKey))[window] ?? 0;
		const allowed = used + amount <= limit;
		const exceeded: PlanDenyReason = window === "day" ? "DAILY_QUOTA_EXCEEDED" : "QUOTA_EXCEEDED";
		return { allowed, limit, used, remaining: remainingOf(limit, used), reason: allowed ? undefined : exceeded };
	}

	/**
	 * Consumo. `false` si no había cuota — el caller debe revertir su operación.
	 * Sólo tiene efecto en features `quota`; en el resto equivale a un `check`.
	 *
	 * En cuotas NO reutiliza `check`: suma primero (`$inc` atómico) y mira el total que devolvió el
	 * propio write; si quedó sobre el límite, revierte y deniega. Leer antes de escribir cuesta una
	 * lectura extra en el camino caliente y abre una carrera entre commits concurrentes.
	 */
	async commit(subject: PlanSubject, featureKey: string, amount = 1): Promise<boolean> {
		const def = this.#catalog.getFeature(featureKey);
		if (def?.kind !== "quota") {
			return (await this.check(subject, featureKey, amount)).allowed;
		}

		const limit = await this.value(subject, featureKey);
		if (limit === undefined) return false;

		const window = def.window ?? "month";
		// Sin tope numérico se mide igual (el consumo alimenta `/api/plans/me`), pero
		// no hay límite que hacer cumplir.
		if (typeof limit !== "number" || limit === UNLIMITED) {
			await this.#usage.increment(subject, featureKey, amount, window);
			return true;
		}

		const total = await this.#usage.increment(subject, featureKey, amount, window);
		if (total > limit) {
			await this.#usage.decrement(subject, featureKey, amount);
			return false;
		}
		return true;
	}

	/** Devuelve consumo previamente comiteado. */
	async release(subject: PlanSubject, featureKey: string, amount = 1): Promise<void> {
		if (this.#catalog.getFeature(featureKey)?.kind !== "quota") return;
		await this.#usage.decrement(subject, featureKey, amount);
	}

	/** Asientos pagos y ocupados de una organización. */
	seats(orgId: string): Promise<{ paidSeats: number; activeSeats: number }> {
		return this.#resolver.seats(orgId);
	}

	/** Lo que la organización tiene asignado como tal, y el tope por miembro derivado. */
	orgSnapshot(orgId: string): Promise<OrgPlanSnapshot> {
		return this.#resolver.orgSnapshot(orgId);
	}
}

/** El tope de asientos deniega con su propio motivo: la UI ofrece comprar, no cambiar de plan. */
function limitReason(featureKey: string): PlanDenyReason {
	return featureKey === SEATS_FEATURE ? "SEAT_LIMIT_REACHED" : "TIER_LIMIT_REACHED";
}
