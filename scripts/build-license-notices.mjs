#!/usr/bin/env bun
/**
 * Genera el aviso de licencias de terceros del código que se sirve al navegador.
 *
 * Por qué existe: el bundle que descarga el visitante **contiene copias** de React, Stencil y
 * compañía, y servirlo es distribuir esas obras — MIT/BSD/ISC lo permiten con una condición:
 * conservar el copyright y el texto de la licencia. El minificador borra los comentarios
 * `/** @license ... *​/`, así que sin este archivo el aviso no viaja con nada.
 *
 * Salida en `src/common/public/` (que UIFederationService sirve en `/` para todas las apps):
 * `licenses.txt` con un bloque por paquete, y `licenses.json` para la página `/licenses`.
 *
 * Entran el cierre transitivo de las deps de cada workspace bajo `apps/` más lo que inyecta el
 * bundler sin declararlo (`BUNDLER_RUNTIME`). Limitación conocida, la misma que
 * `check-lgpl-placement.mjs`: se lee el grafo de `package.json`, no el bundle emitido, así que
 * peca por exceso — el lado correcto del error cuando se trata de atribuir.
 *
 * Uso: `bun run build:licenses` (lo corren también `build:ui` y `start`).
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const NM = join(ROOT, "node_modules");
const OUT_DIR = join(ROOT, "src", "common", "public");
/** Zona cuyos workspaces bundlea rspack hacia el cliente. */
const CLIENT_ZONE = "/apps/";
/**
 * Apps de desarrollo: no se despliegan, así que su árbol (astro, sharp, esbuild y su tooling) no
 * se distribuye a nadie. Incluirlas quintuplicaba el aviso con paquetes que nadie descarga.
 */
const DEV_ZONE = "/src/apps/test/";

/**
 * Runtime que el bundler comparte vía Module Federation sin que ninguna app lo declare
 * (`buildSharedConfig` en UIFederationService). Sin esta semilla el aviso saldría vacío:
 * los `package.json` de las apps casi siempre tienen `dependencies: {}`.
 */
const BUNDLER_RUNTIME = ["@stencil/core", "react", "react-dom", "vue"];

/** Nombres de archivo donde los paquetes publican el texto de su licencia. */
const LICENSE_FILES = [
	"LICENSE",
	"LICENSE.md",
	"LICENSE.txt",
	"LICENCE",
	"LICENCE.md",
	"LICENCE.txt",
	"license",
	"license.md",
	"COPYING",
	"COPYING.md",
	"NOTICE",
];

/* ---------- lectura de paquetes instalados ---------- */
const pkgCache = new Map();

function pkgDir(name) {
	return join(NM, ...name.split("/"));
}

function readInstalledPkg(name) {
	if (pkgCache.has(name)) return pkgCache.get(name);
	const p = join(pkgDir(name), "package.json");
	let v = null;
	if (existsSync(p)) {
		try {
			v = JSON.parse(readFileSync(p, "utf8"));
		} catch {
			/* paquete roto: se ignora, no se inventa */
		}
	}
	pkgCache.set(name, v);
	return v;
}

function licenseIdOf(pkg) {
	const l = pkg?.license ?? pkg?.licenses;
	if (!l) return "";
	if (typeof l === "string") return l;
	if (Array.isArray(l)) return l.map((x) => x.type || x).join(" OR ");
	return l.type || "";
}

function licenseTextOf(name) {
	const dir = pkgDir(name);
	for (const file of LICENSE_FILES) {
		const p = join(dir, file);
		if (!existsSync(p)) continue;
		try {
			const text = readFileSync(p, "utf8").trim();
			if (text) return text;
		} catch {
			/* ilegible: se sigue buscando */
		}
	}
	return "";
}

function homepageOf(pkg) {
	if (typeof pkg?.homepage === "string") return pkg.homepage;
	const repo = pkg?.repository;
	const url = typeof repo === "string" ? repo : repo?.url;
	if (typeof url !== "string") return "";
	return url
		.replace(/^git\+/, "")
		.replace(/^git:\/\//, "https://")
		.replace(/\.git$/, "");
}

function authorOf(pkg) {
	const a = pkg?.author;
	if (typeof a === "string") return a;
	if (a?.name) return a.email ? `${a.name} <${a.email}>` : a.name;
	return "";
}

/* ---------- cierre transitivo ---------- */
function closure(seed) {
	const seen = new Set();
	const stack = [...seed];
	while (stack.length) {
		const n = stack.pop();
		if (seen.has(n)) continue;
		seen.add(n);
		const pj = readInstalledPkg(n);
		if (!pj) continue;
		for (const d of Object.keys(pj.dependencies || {})) if (!seen.has(d)) stack.push(d);
		for (const d of Object.keys(pj.optionalDependencies || {})) if (!seen.has(d)) stack.push(d);
	}
	return seen;
}

/* ---------- workspaces de cliente ---------- */
function findClientWorkspaces() {
	const out = [];
	const roots = ["src", "presets"];
	const skip = new Set(["node_modules", "temp", "dist", "dist-ui", ".git"]);
	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		if (existsSync(join(dir, "package.json")) && dir !== ROOT) {
			out.push(dir);
			return; // los workspaces no anidan
		}
		for (const e of entries) if (e.isDirectory() && !skip.has(e.name)) walk(join(dir, e.name));
	};
	for (const r of roots) walk(join(ROOT, r));
	return out.filter((dir) => {
		const rel = dir.replace(ROOT, "") + "/";
		return rel.includes(CLIENT_ZONE) && !rel.includes(DEV_ZONE);
	});
}

/* ---------- main ---------- */
const seed = new Set(BUNDLER_RUNTIME);
for (const ws of findClientWorkspaces()) {
	let pj;
	try {
		pj = JSON.parse(readFileSync(join(ws, "package.json"), "utf8"));
	} catch {
		continue;
	}
	for (const d of Object.keys(pj.dependencies || {})) seed.add(d);
	for (const d of Object.keys(pj.optionalDependencies || {})) seed.add(d);
}

// Los workspaces first-party no se atribuyen a sí mismos: son este proyecto.
const firstParty = new Set(
	findClientWorkspaces().map((ws) => {
		try {
			return JSON.parse(readFileSync(join(ws, "package.json"), "utf8")).name;
		} catch {
			return "";
		}
	})
);

const packages = [];
for (const name of [...closure(seed)].sort((a, b) => a.localeCompare(b))) {
	if (firstParty.has(name)) continue;
	const pkg = readInstalledPkg(name);
	if (!pkg) continue; // no instalado (dep opcional de otra plataforma): nada que distribuir
	packages.push({
		name,
		version: pkg.version ?? "",
		license: licenseIdOf(pkg) || "UNKNOWN",
		author: authorOf(pkg),
		homepage: homepageOf(pkg),
		text: licenseTextOf(name),
	});
}

const HEADER = `AVISOS DE LICENCIA DE TERCEROS
==============================

El software que esta plataforma sirve a tu navegador incluye copias de los paquetes
de código abierto listados abajo. Cada uno se distribuye bajo su propia licencia, y
sus titulares conservan todos sus derechos; nada de lo que sigue forma parte de la
licencia del código propio de ADC.

Este archivo se genera automáticamente a partir de las dependencias declaradas
(scripts/build-license-notices.mjs). Paquetes: ${packages.length}.
`;

const body = packages
	.map((p) => {
		const head = [
			"-".repeat(78),
			`${p.name}@${p.version}`,
			`Licencia: ${p.license}`,
			p.author ? `Autoría: ${p.author}` : "",
			p.homepage ? `Origen: ${p.homepage}` : "",
			"-".repeat(78),
		]
			.filter(Boolean)
			.join("\n");
		const text = p.text || `(El paquete no publica el texto de la licencia; se declara como "${p.license}".)`;
		return `${head}\n\n${text}\n`;
	})
	.join("\n");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "licenses.txt"), `${HEADER}\n${body}`, "utf8");
writeFileSync(join(OUT_DIR, "licenses.json"), `${JSON.stringify(packages, null, "\t")}\n`, "utf8");

const unknown = packages.filter((p) => p.license === "UNKNOWN").map((p) => p.name);
const noText = packages.filter((p) => !p.text).map((p) => p.name);

console.log(`✅ Avisos de licencia generados: ${packages.length} paquete(s) → src/common/public/licenses.{txt,json}`);
if (unknown.length) console.warn(`⚠️  Sin licencia declarada (${unknown.length}): ${unknown.join(", ")}`);
if (noText.length) console.warn(`⚠️  Sin texto de licencia en el paquete (${noText.length}): ${noText.join(", ")}`);
