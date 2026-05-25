/**
 * Cache TTL en memoria con refresco batched.
 *
 * `fetchAll` se llama una sola vez por ventana TTL, no por slug. El resultado
 * se indexa por `slug` en un Map → lookups O(1) y cero queries adicionales
 * mientras la cache esté caliente.
 *
 * Refrescos concurrentes se deduplican: si llega una segunda petición mientras
 * la primera está fetcheando, ambas comparten la misma Promise.
 */
export class SEOCache<T extends { slug: string }> {
	readonly #entries = new Map<string, T>();
	#expires = 0;
	#refreshing: Promise<void> | null = null;

	constructor(
		private readonly fetchAll: () => Promise<T[]>,
		private readonly ttlMs: number,
	) {}

	async get(slug: string): Promise<T | null> {
		await this.#ensureFresh();
		return this.#entries.get(slug) ?? null;
	}

	async list(): Promise<T[]> {
		await this.#ensureFresh();
		return [...this.#entries.values()];
	}

	invalidate(): void {
		this.#expires = 0;
	}

	async #ensureFresh(): Promise<void> {
		if (Date.now() < this.#expires) return;
		if (this.#refreshing) {
			await this.#refreshing;
			return;
		}
		this.#refreshing = this.#refresh();
		try {
			await this.#refreshing;
		} finally {
			this.#refreshing = null;
		}
	}

	async #refresh(): Promise<void> {
		const items = await this.fetchAll();
		this.#entries.clear();
		for (const i of items) this.#entries.set(i.slug, i);
		this.#expires = Date.now() + this.ttlMs;
	}
}
