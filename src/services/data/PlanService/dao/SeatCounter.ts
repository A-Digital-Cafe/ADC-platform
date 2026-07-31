import type { ILogger } from "@interfaces/utils/ILogger.js";
import LRUCache from "@adc/utils/performance/LRUCache.ts";

/** Fuente mínima para contar miembros de una organización. */
export interface SeatIdentitySource {
	getAllUsers(token: undefined, orgId: string, opts: { limit: number; offset: number }): Promise<{ total: number }>;
}

const CACHE_TTL_MS = 60_000;

/**
 * Miembros ocupando asiento en una organización.
 *
 * **Los asientos pagos NO viven acá**: son el valor de la feature `org.seats`, que sale del plan y
 * admite override por organización, así que comprar asientos es escribir un override. `org.seats`
 * es además siempre plano y se resuelve primero, para no escalar con sí mismo.
 */
export class SeatCounter {
	readonly #identity: SeatIdentitySource;
	readonly #logger: ILogger;
	readonly #cache = new LRUCache<string, { value: number; expiresAt: number }>(500);

	constructor(identity: SeatIdentitySource, logger: ILogger) {
		this.#identity = identity;
		this.#logger = logger;
	}

	/**
	 * Miembros actuales de la org. Ante error devuelve 0 (fail-open: no bloquea altas).
	 *
	 * `fresh` saltea la cache: obligatorio en el camino del **gate de altas**, donde un
	 * conteo de hasta 60 s de antigüedad dejaría entrar miembros de más. El camino de
	 * sólo lectura (el DTO de entitlements) sí usa la cache.
	 */
	async activeSeats(orgId: string, fresh = false): Promise<number> {
		if (!orgId) return 0;
		const cached = fresh ? undefined : this.#cache.get(orgId);
		if (cached && cached.expiresAt > Date.now()) return cached.value;

		let total: number;
		try {
			({ total } = await this.#identity.getAllUsers(undefined, orgId, { limit: 1, offset: 0 }));
		} catch (e) {
			this.#logger.logWarn(`PlanService: no se pudo contar miembros de ${orgId}: ${(e as Error).message}`);
			return 0;
		}
		this.#cache.set(orgId, { value: total, expiresAt: Date.now() + CACHE_TTL_MS });
		return total;
	}

	/** Invalida el conteo de una org (alta/baja de miembro) o de todas. */
	invalidate(orgId?: string): void {
		if (orgId) this.#cache.delete(orgId);
		else this.#cache.clear();
	}
}
