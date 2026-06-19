import path from 'node:path';

/**
 * Valida un nombre de módulo provisto por CLI y devuelve una ruta absoluta
 * garantizada dentro de `baseDir`. Previene path injection (`..`, separadores,
 * rutas absolutas) antes de canonicalizar.
 *
 * @param {string} name   Nombre crudo (process.argv[...]).
 * @param {string} baseDir Directorio base absoluto donde debe vivir el módulo.
 * @returns {string} Ruta absoluta segura (hijo directo de baseDir).
 */
export function resolveModuleDir(name, baseDir) {
	if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
		throw new Error(
			`Invalid module name "${name}". Use only letters, digits and hyphens (e.g. "my-module").`
		);
	}

	const base = path.resolve(baseDir);
	const dir = path.resolve(base, name);

	// Tras canonicalizar, debe ser un hijo directo de baseDir.
	if (path.dirname(dir) !== base) {
		throw new Error(`Refusing to write outside ${base}: "${name}"`);
	}

	return dir;
}

/**
 * Valida una ruta relativa provista por CLI y la resuelve dentro de `rootDir`,
 * rechazando cualquier salida del árbol (path traversal / rutas absolutas).
 *
 * @param {string} relPath Ruta relativa cruda (process.argv[...]).
 * @param {string} rootDir Raíz absoluta que la ruta no puede escapar.
 * @returns {string} Ruta absoluta segura dentro de rootDir.
 */
export function resolveWithinRoot(relPath, rootDir) {
	if (typeof relPath !== 'string' || relPath.length === 0) {
		throw new Error(`Invalid path: "${relPath}"`);
	}

	const root = path.resolve(rootDir);
	const resolved = path.resolve(root, relPath);

	if (resolved !== root && !resolved.startsWith(root + path.sep)) {
		throw new Error(`Refusing to access outside ${root}: "${relPath}"`);
	}

	return resolved;
}
