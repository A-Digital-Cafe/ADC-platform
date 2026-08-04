import path from 'node:path';

const SEGMENT = /^[a-z0-9][a-z0-9-]*$/i;

/**
 * Valida un nombre de módulo provisto por CLI y devuelve una ruta absoluta
 * garantizada dentro de `baseDir`. Previene path injection (`..`, separadores,
 * rutas absolutas) antes de canonicalizar.
 *
 * Acepta `grupo/nombre` además de `nombre` porque ninguna capa guarda sus módulos
 * como hijo directo: viven en `src/apps/public`, `src/services/core`, etc. El regex
 * por segmento excluye `.`, así que un `..` no puede colarse como grupo.
 *
 * @param {string} name   Nombre crudo (process.argv[...]), con un grupo opcional.
 * @param {string} baseDir Directorio base absoluto donde debe vivir el módulo.
 * @returns {string} Ruta absoluta segura, a lo sumo dos niveles bajo baseDir.
 */
export function resolveModuleDir(name, baseDir) {
	const segments = typeof name === 'string' ? name.split('/') : [];
	if (segments.length === 0 || segments.length > 2 || !segments.every((s) => SEGMENT.test(s))) {
		throw new Error(
			`Invalid module name "${name}". Use "group/name" or "name", with letters, digits and hyphens (e.g. "public/my-app").`
		);
	}

	const base = path.resolve(baseDir);
	const dir = path.resolve(base, ...segments);

	// Tras canonicalizar, debe seguir colgando de baseDir con la profundidad pedida.
	const rel = path.relative(base, dir);
	if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).length !== segments.length) {
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
