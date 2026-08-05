import * as path from "node:path";

/** Generación por archivo: sólo sube cuando algo pide re-evaluar ese módulo. */
const generations = new Map<string, number>();

/**
 * URL de import con token ESTABLE por archivo: sin query en la primera carga, y con una
 * nueva sólo después de `invalidateModule`.
 *
 * Un token por import (`?v=${Date.now()}`) crea un registro de módulo distinto en cada
 * carga, reintento y recarga; el runtime los retiene para siempre (no hay forma de
 * desregistrar un módulo ESM), así que el grafo crece con cada boot y cada hot-reload.
 */
export function moduleImportUrl(filePath: string): string {
	const generation = generations.get(path.resolve(filePath));
	return generation ? `${filePath}?v=${generation}` : filePath;
}

/**
 * Fuerza la re-evaluación del módulo en el próximo import. Se llama cuando el archivo
 * cambió en disco (hot-reload) o cuando la carga falló: un módulo que lanzó durante su
 * evaluación queda cacheado con ese error y reimportarlo devolvería el mismo fallo.
 */
export function invalidateModule(filePath: string): void {
	const key = path.resolve(filePath);
	generations.set(key, (generations.get(key) ?? 0) + 1);
}
