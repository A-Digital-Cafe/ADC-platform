import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Ubicación y reset de la caché persistente de rspack.
 *
 * Vive en `@common/utils` y no dentro de `UIFederationService` porque tiene **dos**
 * dueños: quien escribe la config del bundler y quien la invalida tras un deploy
 * (el gestor de módulos). Compartir la convención de ruta por acá evita que las dos
 * caras deriven —que es exactamente el modo de falla que produce "compilé contra una
 * caché que creía de otro módulo".
 */

/**
 * Versión del **contrato** de caché. Bumpear esta constante invalida todas las cachés de
 * golpe, sin borrar nada a mano: rspack aísla por `version`, así que la anterior queda
 * huérfana y se limpia con un reset.
 *
 * Bumpear cuando cambie algo que afecte el resultado del build y que NO esté cubierto por
 * `buildDependencies` (p. ej. un cambio en cómo se resuelven los aliases en tiempo de
 * ejecución del generador).
 */
export const BUNDLER_CACHE_CONTRACT = "1";

/** Raíz de las cachés: bajo `temp/`, que ya está gitignoreado y es descartable. */
function cacheRoot(): string {
	return path.resolve(process.cwd(), "temp", "rspack-cache");
}

/** Directorio de caché de un módulo UI concreto. Un módulo nunca comparte caché con otro. */
export function bundlerCacheDir(namespace: string, moduleName: string): string {
	return path.join(cacheRoot(), namespace, moduleName);
}

/**
 * Borra la caché de bundler. Sin `scope` borra todo; con `namespace`/`module` acota.
 *
 * Es seguro correrlo con la plataforma arriba: rspack recrea el directorio en la próxima
 * escritura y, si no puede, degrada a compilar sin caché. Lo que **no** hace es afectar a
 * un watcher ya corriendo — su estado vive en memoria; el efecto se ve en el próximo
 * arranque del proceso.
 */
export async function clearBundlerCache(scope?: { namespace?: string; module?: string }): Promise<{ target: string; bytes: number }> {
	const target = scope?.namespace
		? scope.module
			? bundlerCacheDir(scope.namespace, scope.module)
			: path.join(cacheRoot(), scope.namespace)
		: cacheRoot();

	// Contención: cualquier scope tiene que caer DENTRO de la raíz. `namespace`/`module`
	// vienen de un body HTTP, así que un `..` no puede convertirse en un rm de otra cosa.
	const root = cacheRoot();
	const resolved = path.resolve(target);
	if (resolved !== root && !resolved.startsWith(root + path.sep)) {
		throw new Error(`clearBundlerCache: scope fuera de la raíz de caché (${resolved})`);
	}

	const bytes = await dirSize(resolved);
	await fs.rm(resolved, { recursive: true, force: true });
	return { target: path.relative(process.cwd(), resolved), bytes };
}

async function dirSize(dir: string): Promise<number> {
	let total = 0;
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			total += await dirSize(full);
		} else {
			total += await fs.stat(full).then((s) => s.size, () => 0);
		}
	}
	return total;
}
