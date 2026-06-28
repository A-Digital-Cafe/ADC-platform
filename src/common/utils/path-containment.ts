import * as path from "node:path";

/**
 * Defensa anti path-traversal para sinks que construyen rutas de archivo a partir
 * de input semi-confiable (nombres de módulo de `config.json`, paths de request,
 * ...). Resolvés base y candidato a absoluto y comprobás contención, en lugar de
 * confiar en que el input no traiga `..`.
 */

/**
 * `true` si `filePath` resuelve exactamente a `baseDir` o a un descendiente suyo.
 * El prefijo se compara con `path.sep` para evitar falsos positivos por prefijo
 * de string (ej. `/a/bc` NO está dentro de `/a/b`).
 */
export function isInsideBase(baseDir: string, filePath: string): boolean {
	const resolvedBase = path.resolve(baseDir);
	const resolvedFile = path.resolve(filePath);
	return resolvedFile === resolvedBase || resolvedFile.startsWith(`${resolvedBase}${path.sep}`);
}

/** `true` si `filePath` está contenido en alguna de las raíces dadas (no vacías). */
export function isInsideAnyBase(baseDirs: string | string[], filePath: string): boolean {
	const bases = Array.isArray(baseDirs) ? baseDirs : [baseDirs];
	return bases.some((base) => Boolean(base) && isInsideBase(base, filePath));
}

/**
 * Valida un nombre de módulo declarado en config (`name`) antes de usarlo para
 * construir un path de carga. Los nombres admiten `/` como subpath legítimo
 * (ej. `object/mongo`, `queue/redis`), pero NO segmentos `..` ni bytes nulos:
 * eso permitiría escapar del árbol de módulos en `path.join` y terminar
 * importando/ejecutando código fuera de las raíces permitidas. Vacío/nulo se
 * rechaza.
 */
export function isSafeModuleName(name: string | undefined | null): name is string {
	if (!name || name.includes("\0")) return false;
	return !name.split(/[\\/]/).includes("..");
}
