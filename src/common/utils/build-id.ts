/**
 * Identidad de los artefactos de UI que sirve ESTE nodo.
 *
 * Existe por un modo de falla que no se diagnostica desde el navegador: los remotes de Module
 * Federation se resuelven por vhost (`publicPath: '/'`), así que dos nodos sirviendo el mismo
 * dominio con builds distintos hacen que un cliente pida `remoteEntry.js` a uno y un chunk al otro
 * → **404 intermitente**. Lo que evita eso es poder comparar builds entre nodos, y para comparar
 * hace falta un identificador que se **derive** del build y no una etiqueta que alguien recuerde
 * poner.
 *
 * Se compone de lo único que decide el resultado:
 *
 * 1. El **sha desplegado** de cada repo (la raíz y cada preset): cubre el código versionado.
 * 2. El contenido de los archivos que **no** son módulos de ningún grafo de bundler y aun así
 *    cambian el bundle — el lockfile y la identidad pública horneada. Son los mismos que invalidan
 *    la caché de rspack, y por eso la lista vive acá y no duplicada en cada lado.
 *
 * Se lee el `.git` a mano en vez de invocar `git`: esto corre en cada latido del clúster, y un
 * proceso por repo cada diez segundos —en un despliegue que ni siquiera tiene por qué tener git
 * instalado— es un precio absurdo por dos archivos de 41 bytes.
 *
 * **Lo que NO ve**: cambios sin commitear. Es aceptable porque el camino de despliegue aborta con
 * el árbol sucio, pero significa que en desarrollo el id no se mueve al editar un archivo.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Forma admitida: entra en una cookie y en una comparación entre nodos, así que nada raro. */
const BUILD_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

let cached: string | null = null;

/**
 * Archivos que cambian el bundle sin que ningún bundler los vea como módulo: el lockfile fija qué
 * versiones entran, el `package.json` de la raíz los scripts y campos que gobiernan el build, y la
 * identidad pública se hornea como valores literales.
 *
 * Los comparten dos consumidores —la invalidación de la caché de rspack y el `build-id`— y tienen
 * que ser **la misma lista**: si divergen, una caché válida puede sobrevivir a un cambio que el
 * `build-id` sí ve, que es el peor de los dos mundos (el nodo se declara actualizado sirviendo
 * artefactos viejos).
 */
export function sharedBundleInputs(): string[] {
	const root = process.cwd();
	return [
		path.join(root, "package.json"),
		path.join(root, "bun.lock"),
		path.join(root, "src", "common", "utils", "public-env.generated.ts"),
	];
}

/** Directorio real de `.git`, resolviendo el archivo-puntero de worktrees y submódulos. */
function gitDir(repoDir: string): string | null {
	const dotGit = path.join(repoDir, ".git");
	let raw: string;
	try {
		raw = fs.readFileSync(dotGit, "utf8");
	} catch (error) {
		// Un `stat` previo para distinguir el caso normal sería una carrera: el propio `read` ya
		// separa el repo común (EISDIR) de "acá no hay repo" sin una segunda mirada al disco.
		return (error as NodeJS.ErrnoException).code === "EISDIR" ? dotGit : null;
	}
	const pointer = /^gitdir:\s*(.+)$/m.exec(raw)?.[1]?.trim();
	return pointer ? path.resolve(repoDir, pointer) : null;
}

/** Sha de HEAD de un repo, o `null` si no hay repo (despliegue por tarball, preset copiado a mano). */
function headSha(repoDir: string): string | null {
	const dir = gitDir(repoDir);
	if (!dir) return null;
	try {
		const head = fs.readFileSync(path.join(dir, "HEAD"), "utf8").trim();
		// Detached HEAD (que es como queda un deploy pinneado a un commit): el sha está ahí mismo.
		if (!head.startsWith("ref:")) return head || null;
		const ref = head.slice(4).trim();
		try {
			return fs.readFileSync(path.join(dir, ref), "utf8").trim() || null;
		} catch {
			// El ref puede estar empaquetado (`git gc`): ahí no existe como archivo suelto.
			const packed = fs.readFileSync(path.join(dir, "packed-refs"), "utf8");
			const line = packed.split("\n").find((entry) => entry.endsWith(` ${ref}`));
			return line?.slice(0, 40) ?? null;
		}
	} catch {
		return null;
	}
}

/** Repos que aportan código al despliegue: la raíz y cada preset, en orden estable. */
function deployedRepos(): Array<[string, string]> {
	const root = process.cwd();
	const repos: Array<[string, string]> = [["core", root]];
	try {
		for (const entry of fs.readdirSync(path.join(root, "presets"), { withFileTypes: true })) {
			if (entry.isDirectory()) repos.push([`preset:${entry.name}`, path.join(root, "presets", entry.name)]);
		}
	} catch {
		/* sin presets: el despliegue es sólo el core */
	}
	return repos.sort(([a], [b]) => a.localeCompare(b));
}

function compute(): string {
	const hash = createHash("sha256");
	for (const [name, dir] of deployedRepos()) hash.update(`${name}@${headSha(dir) ?? "sin-git"}\n`);
	for (const file of sharedBundleInputs()) {
		hash.update(`${path.basename(file)}=`);
		try {
			hash.update(fs.readFileSync(file));
		} catch {
			// Ausente cuenta como un estado más: un nodo sin `public-env.generated.ts` sirve una UI
			// distinta a uno que sí lo tiene, y eso tiene que separar los dos ids.
			hash.update("ausente");
		}
		hash.update("\n");
	}
	return hash.digest("hex").slice(0, 16);
}

/**
 * Recalcula el `build-id` y lo memoriza. Lo llama el latido del clúster: un deploy mueve el sha sin
 * reiniciar el proceso, así que un valor calculado una sola vez al arrancar mentiría justo cuando
 * más importa.
 */
export function refreshBuildId(): string {
	// `ADC_BUILD_ID` gana siempre: si los artefactos los produce un pipeline externo, el sha de git
	// describe el código pero no lo que quedó en disco, y el que sabe es el pipeline.
	const declared = process.env.ADC_BUILD_ID?.trim();
	cached = declared && BUILD_ID_RE.test(declared) ? declared : compute();
	return cached;
}

/** `build-id` vigente de este proceso. Barato: no recalcula (de eso se ocupa {@link refreshBuildId}). */
export function buildId(): string {
	cached ??= refreshBuildId();
	return cached;
}

/** Normaliza un `build-id` que llega de afuera (una cookie); `null` si no tiene forma de tal. */
export function sanitizeBuildId(raw: string | undefined | null): string | null {
	const value = raw?.trim();
	return value && BUILD_ID_RE.test(value) ? value : null;
}
