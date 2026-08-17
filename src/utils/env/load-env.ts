/**
 * Carga el entorno de la raíz desde `env/<grupo>.env`, en el orden declarado por el manifiesto.
 *
 * Se importa como **primera línea de `kernel.ts`**, antes que nada que pueda leer `process.env`.
 *
 * No alcanza con leer los archivos: bun **autocarga `.env`, `.env.local` y `.env.<NODE_ENV>` en
 * `process.env` antes de la primera línea del proceso**, así que un `Object.keys(process.env)` al
 * importar ya trae las claves del `.env` y protegerlas sería dar por «exportado en el shell» lo que
 * en realidad inyectó bun. Con el `.env` partido en `env/`, eso pasa a ser un modo de fallo: un
 * `.env` monolítico olvidado en la raíz le ganaría en silencio a la carpeta entera.
 *
 * Por eso se **restan** del conjunto protegido las claves que vinieron del autoload, y se avisa si
 * los dos orígenes coexisten con valores distintos.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { ENV_GROUP_ORDER } from "../../common/utils/env-manifest.js";

/** Archivos que bun autocarga por su cuenta antes de que corra este módulo. */
const BUN_AUTOLOADED = [".env", ".env.local", process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : null].filter((f): f is string => !!f);

/**
 * Dónde buscar `env/`. **No alcanza con `process.cwd()`**: un service manager que arranque el
 * proceso con otro working directory (un `systemd` sin `WorkingDirectory`, un `bun /ruta/al/repo/src/index.ts`
 * lanzado desde otro lado) no encontraba la carpeta y el nodo levantaba con los defaults de cada
 * `config.json` **sin una sola línea de aviso** — el fallo se veía después, lejos, como "esta
 * variable no toma".
 *
 * El cwd sigue teniendo prioridad: permite correr una copia del árbol con otra configuración sin
 * tocar nada. Si ahí no está, se cae a la raíz derivada de la ubicación de este archivo.
 */
const MODULE_ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");
const ROOT = existsSync(resolve(process.cwd(), "env")) ? process.cwd() : MODULE_ROOT;

function readEnvFile(fileName: string, base: string = ROOT): Record<string, string> | null {
	const filePath = resolve(base, fileName);
	if (!existsSync(filePath)) return null;
	try {
		return parse(readFileSync(filePath));
	} catch {
		// Un archivo ilegible no puede tumbar el arranque antes de que exista un logger.
		return null;
	}
}

/**
 * Claves realmente puestas por el operador (`FOO=1 bun run dev`, systemd, docker): esas mandan sobre
 * cualquier archivo. Todo lo que bun inyectó desde un `.env` NO cuenta como tal.
 */
const legacyFiles = new Map<string, Record<string, string>>();
for (const file of BUN_AUTOLOADED) {
	// Contra el cwd y no contra ROOT: son los que autocarga bun, y bun los busca ahí.
	const values = readEnvFile(file, process.cwd());
	if (values) legacyFiles.set(file, values);
}

const protectedKeys = new Set(Object.keys(process.env));
for (const values of legacyFiles.values()) {
	for (const key of Object.keys(values)) protectedKeys.delete(key);
}

/** De dónde salió cada clave, para poder señalar el conflicto con nombre y apellido. */
const sourceOf = new Map<string, string>();

function apply(fileName: string, values: Record<string, string>): void {
	for (const [key, value] of Object.entries(values)) {
		if (protectedKeys.has(key)) continue;
		process.env[key] = value;
		sourceOf.set(key, fileName);
	}
}

const envDir = resolve(ROOT, "env");
const hasEnvDir = existsSync(envDir);
/** Grupos que aportaron algo. Vacío con la carpeta presente = archivos vacíos o ilegibles. */
const loadedGroups: string[] = [];

if (hasEnvDir) {
	for (const group of ENV_GROUP_ORDER) {
		const values = readEnvFile(`env/${group}.env`);
		if (values) {
			apply(`env/${group}.env`, values);
			loadedGroups.push(group);
		}
	}
	// Overlay por entorno, después de su base: `env/build.development.env`.
	if (process.env.NODE_ENV) {
		for (const group of ENV_GROUP_ORDER) {
			const values = readEnvFile(`env/${group}.${process.env.NODE_ENV}.env`);
			if (values) apply(`env/${group}.${process.env.NODE_ENV}.env`, values);
		}
	}
}

// Los `.env` de la raíz son el camino legacy. Se siguen aplicando —un clon sin `env/` tiene que
// arrancar igual que siempre— pero cuando la carpeta existe, lo que hacen es tapar.
const conflicts: string[] = [];
for (const [file, values] of legacyFiles) {
	for (const [key, value] of Object.entries(values)) {
		if (protectedKeys.has(key)) continue;
		if (hasEnvDir && sourceOf.has(key) && process.env[key] !== value) {
			conflicts.push(`${key} (${sourceOf.get(key)} vs ${file})`);
		}
		process.env[key] = value;
	}
}

/**
 * Que no haya nada que cargar **se dice**. Este módulo era mudo cuando no encontraba la carpeta, y
 * ése era el peor modo de fallo posible: el nodo levantaba con los defaults de cada `config.json`,
 * todo parecía andar, y la variable que el operador acababa de editar simplemente no existía. Es un
 * `warn` y no un throw porque un clon recién bajado tiene que poder arrancar sin configurar nada.
 */
if (!hasEnvDir) {
	console.warn(`[env] no hay carpeta env/ (buscada en ${process.cwd()} y en ${MODULE_ROOT}): se arranca con los defaults de cada config.json.`);
} else if (loadedGroups.length === 0) {
	console.warn(`[env] ${envDir} existe pero no aportó ninguna variable: revisá que los archivos se llamen <grupo>.env y sean legibles.`);
}

if (conflicts.length > 0) {
	const detail = conflicts.slice(0, 10).join(", ") + (conflicts.length > 10 ? `, +${conflicts.length - 10} más` : "");
	const message =
		`Hay un .env en la raíz que pisa a env/ con valores distintos: ${detail}. ` +
		`El split quedó a medias — correr 'bun run env:split' y borrar el .env viejo (queda como .env.pre-split.bak).`;
	// Sin logger todavía: esto corre antes que el kernel. En producción es fatal a propósito —
	// arrancar con la mitad de la configuración de un origen y la mitad del otro es peor que no
	// arrancar, y el síntoma aparecería lejos de la causa.
	if (process.env.NODE_ENV === "production") throw new Error(message);
	console.warn(`[env] ${message}`);
}
