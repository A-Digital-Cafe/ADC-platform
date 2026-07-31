import type { Model } from "mongoose";
import { UNLIMITED, type FeatureValue } from "@common/types/plans/index.ts";
import type { PlanOverrideDoc, PlanSubjectType } from "../domain/index.ts";
import type { IdentitySource } from "./TierResolver.ts";
import LRUCache from "@adc/utils/performance/LRUCache.ts";

/** Mismo TTL que `TierResolver`: los dos dependen de datos de identity que cambian por fuera. */
const CACHE_TTL_MS = 30_000;

interface Cached {
	value: Map<string, FeatureValue>;
	expiresAt: number;
}

/**
 * Lado de **lectura** de las excepciones de límite.
 *
 * Precedencia con org activa: override de usuario → máximo de overrides de sus
 * roles en esa org → default por miembro (`org-members-default`). Sin org:
 * override global de usuario → máximo de overrides de roles globales.
 *
 * En valores no numéricos (flags, enums) no hay "máximo": gana el primero
 * encontrado según la precedencia. El clamp contra el valor de la org lo aplica
 * el caller (`PlanResolver`), que es quien lo conoce.
 *
 * **Cacheado con TTL corto**: resolver un sujeto son 3-4 consultas y ocurre en el camino caliente
 * de cada chequeo de límite (`commit()` vuelve a resolver antes de sumar).
 */
export class OverrideResolver {
	readonly #model: Model<PlanOverrideDoc>;
	readonly #identity: IdentitySource;
	readonly #cache = new LRUCache<string, Cached>(2000);

	constructor(model: Model<PlanOverrideDoc>, identity: IdentitySource) {
		this.#model = model;
		this.#identity = identity;
	}

	/**
	 * Descarta **toda** la cache: un override de rol o un `org-members-default` cambian el resultado
	 * de cualquier usuario que caiga bajo ellos, y esa lista no se puede enumerar barata.
	 */
	invalidate(): void {
		this.#cache.clear();
	}

	/**
	 * Copia del mapa cacheado, o `null` si no hay entrada vigente. Se copia para que un consumidor
	 * que escriba encima no corrompa la instancia compartida.
	 */
	#cached(key: string): Map<string, FeatureValue> | null {
		const hit = this.#cache.get(key);
		if (!hit || hit.expiresAt <= Date.now()) return null;
		return new Map(hit.value);
	}

	#store(key: string, value: Map<string, FeatureValue>): Map<string, FeatureValue> {
		this.#cache.set(key, { value: new Map(value), expiresAt: Date.now() + CACHE_TTL_MS });
		return value;
	}

	/**
	 * Overrides aplicables a un sujeto, indexados por feature. Una sola consulta por
	 * nivel de precedencia.
	 */
	async resolveForSubject(userId: string, orgId: string | null): Promise<Map<string, FeatureValue>> {
		const key = `s|${userId}|${orgId ?? ""}`;
		const cached = this.#cached(key);
		if (cached) return cached;

		const result = new Map<string, FeatureValue>();

		// Menor a mayor precedencia: los niveles más específicos pisan a los generales.
		if (orgId) {
			merge(result, await this.#find({ subjectType: "org-members-default", subjectId: orgId, orgId }));
			const user = await this.#identity.getUser(userId).catch(() => null);
			const roleIds = user?.orgMemberships?.find((m) => m.orgId === orgId)?.roleIds ?? [];
			merge(result, await this.#roleOverrides(roleIds, orgId));
		} else {
			const user = await this.#identity.getUser(userId).catch(() => null);
			merge(result, await this.#roleOverrides(user?.roleIds ?? [], null));
		}
		merge(result, await this.#find({ subjectType: "user", subjectId: userId, orgId }));
		return this.#store(key, result);
	}

	/** Overrides asignados a la organización como tal (nivel de la org, no de sus miembros). */
	async resolveForOrg(orgId: string): Promise<Map<string, FeatureValue>> {
		const key = `o|${orgId}`;
		const cached = this.#cached(key);
		if (cached) return cached;

		const result = new Map<string, FeatureValue>();
		merge(result, await this.#find({ subjectType: "org", subjectId: orgId, orgId: null }));
		return this.#store(key, result);
	}

	/** Tope por miembro administrado para una organización (`org-members-default`). */
	async resolveMembersDefault(orgId: string): Promise<Map<string, FeatureValue>> {
		const key = `m|${orgId}`;
		const cached = this.#cached(key);
		if (cached) return cached;

		const result = new Map<string, FeatureValue>();
		merge(result, await this.#find({ subjectType: "org-members-default", subjectId: orgId, orgId }));
		return this.#store(key, result);
	}

	async #find(filter: { subjectType: PlanSubjectType; subjectId: string; orgId: string | null }): Promise<PlanOverrideDoc[]> {
		return this.#model.find(filter).lean<PlanOverrideDoc[]>();
	}

	/** Overrides de una lista de roles; en numéricos gana el máximo (`UNLIMITED` manda). */
	async #roleOverrides(roleIds: string[], orgId: string | null): Promise<PlanOverrideDoc[]> {
		if (!roleIds.length) return [];
		const docs = await this.#model.find({ subjectType: "role", subjectId: { $in: roleIds }, orgId }).lean<PlanOverrideDoc[]>();
		if (docs.length <= 1) return docs;

		const best = new Map<string, PlanOverrideDoc>();
		for (const d of docs) {
			const current = best.get(d.featureKey);
			if (!current) {
				best.set(d.featureKey, d);
				continue;
			}
			if (typeof d.value !== "number" || typeof current.value !== "number") continue;
			if (current.value === UNLIMITED) continue;
			if (d.value === UNLIMITED || d.value > current.value) best.set(d.featureKey, d);
		}
		return [...best.values()];
	}
}

/** Vuelca documentos sobre el mapa acumulado: el último nivel escrito gana. */
function merge(target: Map<string, FeatureValue>, docs: PlanOverrideDoc[]): void {
	for (const d of docs) target.set(d.featureKey, d.value);
}
