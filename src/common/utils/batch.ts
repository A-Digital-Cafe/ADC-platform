/**
 * Recorrido por lotes de colecciones potencialmente ilimitadas, sin materializarlas
 * enteras en memoria. Útil para barridos que DEBEN procesar todo pero no pueden cargar
 * todo de una (purga de cuenta, recuperación masiva, cascadas de borrado). Es control de
 * flujo puro: la query concreta vive en el closure `fetchPage`.
 */

/** Tamaño de página por defecto. Acota la memoria a O(batchSize) por iteración. */
const DEFAULT_BATCH_SIZE = 500;

/**
 * Pagina hacia adelante por una clave `id` ascendente y estable (cursor), procesando
 * cada página con `handlePage`. No depende de que `handlePage` mute la colección: avanza
 * por el `id` del último item, así que los items ya vistos (procesados, salteados o que
 * fallaron) nunca se vuelven a traer → sin riesgo de bucle infinito.
 *
 * `fetchPage(afterId, limit)` debe devolver hasta `limit` items con `id > afterId`
 * (o desde el principio si `afterId` es `null`), **ordenados por `id` ascendente**.
 * El recorrido corta cuando una página vuelve vacía o con menos de `limit` items.
 *
 * Requiere un índice sobre `id` para ser eficiente.
 *
 * @returns cantidad total de items recorridos.
 */
export async function forEachPage<T extends { id: string }>(
	fetchPage: (afterId: string | null, limit: number) => Promise<T[]>,
	handlePage: (items: T[]) => Promise<void>,
	batchSize: number = DEFAULT_BATCH_SIZE
): Promise<number> {
	if (batchSize <= 0) throw new Error("forEachPage: batchSize debe ser > 0");
	let afterId: string | null = null;
	let total = 0;
	for (;;) {
		const page = await fetchPage(afterId, batchSize);
		if (page.length === 0) return total;
		await handlePage(page);
		total += page.length;
		afterId = page.at(-1)?.id ?? null;
		if (page.length < batchSize) return total;
	}
}
