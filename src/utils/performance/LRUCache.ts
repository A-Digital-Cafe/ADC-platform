export default class LRUCache<K, V> {
	readonly #cache = new Map<K, V>();
	readonly #maxSize: number;
	readonly #onEvict?: (key: K, value: V) => void;

	/**
	 * `onEvict` corre SÓLO cuando `set` desaloja por tamaño (no en `delete`/`clear`, donde el
	 * caller ya tiene el valor y decide él mismo qué hacer). Pensado para liberar un recurso
	 * externo que el valor cacheado retiene (p. ej. una vista de conexión) y que de otro modo
	 * sobreviviría a su entrada en esta cache.
	 */
	constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
		this.#maxSize = maxSize;
		this.#onEvict = onEvict;
	}

	get(key: K): V | undefined {
		const value = this.#cache.get(key);
		if (value !== undefined) {
			// Move to end (most recently used)
			this.#cache.delete(key);
			this.#cache.set(key, value);
		}
		return value;
	}

	set(key: K, value: V): void {
		if (this.#cache.has(key)) {
			this.#cache.delete(key);
		} else if (this.#cache.size >= this.#maxSize) {
			// Remove least recently used (first item)
			const firstKey = this.#cache.keys().next().value;
			if (firstKey !== undefined) {
				const evicted = this.#cache.get(firstKey) as V;
				this.#cache.delete(firstKey);
				this.#onEvict?.(firstKey, evicted);
			}
		}
		this.#cache.set(key, value);
	}

	delete(key: K): boolean {
		return this.#cache.delete(key);
	}

	clear(): void {
		this.#cache.clear();
	}

	keys(): IterableIterator<K> {
		return this.#cache.keys();
	}
}
