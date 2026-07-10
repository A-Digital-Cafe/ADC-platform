#!/usr/bin/env node
/* global console */
/**
 * Generates utils/react-jsx.ts from Stencil's auto-generated src/components.d.ts
 *
 * Creates a standalone React JSX declaration file with typed props for every
 * adc-* web component, without importing Stencil sources (avoids JSX conflicts).
 *
 * Usage:
 *   node scripts/generate-react-jsx.mjs                          # default: public library
 *   node scripts/generate-react-jsx.mjs src/apps/test/00-web-ui-library
 *   node scripts/generate-react-jsx.mjs --all                    # all ui-libraries
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { resolveWithinRoot } from "./lib/safe-path.mjs";

const __filename = fileURLToPath(import.meta.url);
// `resolve` (y no un replace de "/scripts") para que funcione también con paths Windows.
const ROOT = resolve(dirname(__filename), "..");

// ─── Helpers ───

/** Extract a brace-delimited block starting at the opening `{`. */
function extractBraceBlock(text, openPos) {
	let depth = 0;
	for (let i = openPos; i < text.length; i++) {
		if (text[i] === "{") depth++;
		if (text[i] === "}") {
			depth--;
			if (depth === 0) return text.slice(openPos, i + 1);
		}
	}
	return "";
}

/**
 * Extract an exported interface definition from a source file.
 * Returns the full `interface Name { ... }` string (without `export`).
 */
function extractInterface(srcContent, name) {
	const re = new RegExp(String.raw`export\s+interface\s+${name}\s*(?:extends\s[^{]*)?\{`);
	const m = srcContent.match(re);
	if (!m) return null;
	const braceStart = srcContent.indexOf("{", m.index + m[0].length - 1);
	const block = extractBraceBlock(srcContent, braceStart);
	const header = m[0].replace(/^export\s+/, "");
	return header.slice(0, header.indexOf("{")) + block;
}

/**
 * Extract a non-exported type alias from a source file.
 * e.g. `type Align = "left" | "center" | "right";`
 */
function extractLocalType(srcContent, name) {
	const re = new RegExp(String.raw`^[ \t]*type\s+${name}\s*=\s*([^;]+);`, "m");
	const m = srcContent.match(re);
	if (!m) return null;
	return `type ${name} = ${m[1].trim()};`;
}

/**
 * Extract an exported type alias from a source file.
 * e.g. `export type AttachmentUrlMap = Record<string, string>;`
 */
function extractExportedType(srcContent, name) {
	const re = new RegExp(String.raw`export\s+type\s+${name}\s*=\s*([^;]+);`);
	const m = srcContent.match(re);
	if (!m) return null;
	return `type ${name} = ${m[1].trim()};`;
}

/** Recursively walk a directory collecting .ts/.tsx files. */
function walkSrcFiles(dir, acc = []) {
	if (!existsSync(dir)) return acc;
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) walkSrcFiles(full, acc);
		else if (/\.(tsx?|ts)$/.test(entry)) acc.push(full);
	}
	return acc;
}

/** Build a registry of exported interfaces/types across the lib's src/. */
function buildExportRegistry(srcDir) {
	const files = walkSrcFiles(srcDir);
	/** @type {Map<string, string>} name → file content */
	const nameToFile = new Map();
	for (const f of files) {
		const content = readFileSync(f, "utf-8");
		const ifaceRe = /export\s+interface\s+(\w+)/g;
		const typeRe = /export\s+type\s+(\w+)\s*=/g;
		let m;
		while ((m = ifaceRe.exec(content)) !== null) {
			if (!nameToFile.has(m[1])) nameToFile.set(m[1], content);
		}
		while ((m = typeRe.exec(content)) !== null) {
			if (!nameToFile.has(m[1])) nameToFile.set(m[1], content);
		}
	}
	return nameToFile;
}

// ─── Type collection (imports del components.d.ts + resolución recursiva) ───

/** Resuelve el archivo fuente (.tsx/.ts) de un import relativo del components.d.ts. */
function resolveSourceFile(absLib, sourceRel) {
	const basePath = sourceRel.replace(/^\.\//, "").replace(/\.js$/, "");
	let srcFile = resolve(absLib, "src", basePath + ".tsx");
	if (!existsSync(srcFile)) srcFile = resolve(absLib, "src", basePath + ".ts");
	return existsSync(srcFile) ? srcFile : null;
}

/**
 * Imports de tipos custom del components.d.ts (fuentes .tsx propias, no @stencil).
 * @returns {Map<string, {original: string, sourceRel: string}>} alias → info
 */
function collectTypeImports(lines) {
	const typeImports = new Map();
	for (const line of lines) {
		const m = line.match(/^import\s+\{(.+?)\}\s+from\s+"(\.[^"]+)"/);
		if (!m || m[2].includes("@stencil")) continue;
		for (const part of m[1].split(",")) {
			const [raw, alias] = part.trim().split(" as ");
			const name = (alias || raw).trim();
			typeImports.set(name, { original: raw.trim(), sourceRel: m[2] });
		}
	}
	return typeImports;
}

/**
 * Extrae las definiciones de los tipos importados, deduplicando aliases
 * (AccessMenuItem1 ≡ AccessMenuItem) hacia su nombre canónico.
 */
function extractImportedTypeDefs(absLib, typeImports) {
	/** @type {{typeAliases: Map<string,string>, typeDefs: Map<string,string>, extraDefs: string[]}} */
	const acc = { typeAliases: new Map(), typeDefs: new Map(), extraDefs: [] };
	for (const [alias, { original, sourceRel }] of typeImports) {
		extractOneImportedType(absLib, { alias, original, sourceRel }, acc);
	}
	return acc;
}

/** Extrae la definición de un tipo importado hacia `acc`, deduplicando aliases hacia el canónico. */
function extractOneImportedType(absLib, { alias, original, sourceRel }, acc) {
	const noteAlias = () => {
		if (alias !== original) acc.typeAliases.set(alias, original);
	};

	const srcFile = resolveSourceFile(absLib, sourceRel);
	if (!srcFile) return;

	// Alias de un tipo ya extraído (dedup)
	if (acc.typeDefs.has(original)) {
		noteAlias();
		return;
	}

	const srcContent = readFileSync(srcFile, "utf-8");
	const def = extractInterface(srcContent, original);
	if (def) {
		acc.typeDefs.set(original, def);
		noteAlias();
		return;
	}

	// Try as exported type alias
	const typeDef = extractExportedType(srcContent, original);
	if (typeDef) {
		acc.extraDefs.push(`export ${typeDef}`);
		noteAlias();
	}
}

const BUILT_INS = new Set([
	"string", "number", "boolean", "any", "unknown", "void", "null",
	"undefined", "never", "object", "Array", "Record", "Map", "Set",
	"Promise", "Partial", "Required", "Readonly", "Pick", "Omit",
	"true", "false", "Event", "MouseEvent", "KeyboardEvent",
	"HTMLElement", "Element", "EventEmitter", "CustomEvent",
]);
const REF_REGEX = /(?<!\w)([A-Z][a-zA-Z0-9]+)(?=[\s;[\]|&,?>)}])/g;

function isKnownType(ref, typeDefs, extraDefs) {
	return BUILT_INS.has(ref) || typeDefs.has(ref) || extraDefs.some((d) => d.includes(`type ${ref} =`) || d.includes(`type ${ref}=`));
}

/** Resuelve recursivamente tipos referenciados que falten, buscando en el registry de exports. */
function resolveReferencedTypes(typeDefs, extraDefs, exportRegistry) {
	const queue = [...typeDefs.entries()].map(([n, d]) => ({ name: n, def: d }));
	while (queue.length > 0) {
		const { def } = queue.shift();
		let rm;
		while ((rm = REF_REGEX.exec(def)) !== null) {
			const ref = rm[1];
			if (isKnownType(ref, typeDefs, extraDefs)) continue;

			// Try the registry: any exported interface/type in the lib
			const regContent = exportRegistry.get(ref);
			if (!regContent) continue;
			const ifaceDef = extractInterface(regContent, ref);
			if (ifaceDef) {
				typeDefs.set(ref, ifaceDef);
				queue.push({ name: ref, def: ifaceDef });
				continue;
			}
			const typeDef = extractExportedType(regContent, ref);
			if (typeDef) {
				extraDefs.push(`export ${typeDef}`);
				queue.push({ name: ref, def: typeDef });
			}
		}
		REF_REGEX.lastIndex = 0;
	}
}

/** Suma tipos locales NO exportados desde los archivos fuente de los imports originales. */
function pullLocalTypes(absLib, typeImports, typeDefs, extraDefs) {
	for (const [, { sourceRel }] of typeImports) {
		const srcFile = resolveSourceFile(absLib, sourceRel);
		if (!srcFile) continue;
		pullLocalTypesFromSource(readFileSync(srcFile, "utf-8"), typeDefs, extraDefs);
	}
}

/** Busca en un archivo fuente definiciones locales para referencias aún sin resolver. */
function pullLocalTypesFromSource(srcContent, typeDefs, extraDefs) {
	for (const [, def] of typeDefs) {
		let rm;
		while ((rm = REF_REGEX.exec(def)) !== null) {
			const ref = rm[1];
			if (isKnownType(ref, typeDefs, extraDefs)) continue;
			const localDef = extractLocalType(srcContent, ref);
			if (localDef) extraDefs.push(localDef);
		}
		REF_REGEX.lastIndex = 0;
	}
}

// ─── LocalJSX parsing ───

/**
 * Une declaraciones de props multilínea en líneas lógicas (acumula hasta que
 * las llaves balancean y la línea termina en `;`); los JSDoc pasan tal cual.
 */
function joinLogicalPropLines(block) {
	// The block string includes the surrounding `{` and `}` — strip them first.
	const innerBlock = block.replace(/^\s*\{/, "").replace(/\}\s*$/, "");
	const blockLines = [];
	let pending = "";
	let pendingDepth = 0;

	const braceDelta = (line) => {
		let depth = 0;
		for (const ch of line) {
			if (ch === "{") depth++;
			else if (ch === "}") depth--;
		}
		return depth;
	};

	for (const rawLine of innerBlock.split("\n")) {
		const trimmedRaw = rawLine.trim();
		// JSDoc passes through as-is to keep buffer tracking simple
		if (pending === "" && (trimmedRaw.startsWith("/**") || trimmedRaw.startsWith("*") || trimmedRaw.endsWith("*/"))) {
			blockLines.push(rawLine);
			continue;
		}
		if (pending === "") {
			pending = rawLine;
			pendingDepth = braceDelta(rawLine);
		} else {
			pending += " " + trimmedRaw;
			pendingDepth += braceDelta(rawLine);
		}
		if (pendingDepth <= 0 && trimmedRaw.endsWith(";")) {
			blockLines.push(pending);
			pending = "";
			pendingDepth = 0;
		}
	}
	if (pending) blockLines.push(pending);
	return blockLines;
}

/** Reescribe el tipo de una prop: aliases → canónico y, para eventos, ComponentCustomEvent<T> → CustomEvent<T>. */
function resolvePropType(propType, propName, typeAliases) {
	let resolvedType = propType;
	for (const [alias, canonical] of typeAliases) {
		resolvedType = resolvedType.replaceAll(new RegExp(String.raw`\b${alias}\b`, "g"), canonical);
	}
	if (propName.startsWith("onAdc")) {
		// `\b` limita el intento de match al inicio de cada palabra: sin él, cada
		// posición interna de un identificador reescanea `[^>]+` completo
		// (backtracking super-lineal, javascript:S8786). Filtramos en código los
		// que terminan en `CustomEvent` para preservar el comportamiento original.
		resolvedType = resolvedType.replaceAll(/\b\w+<([^>]+)>/g, (match, inner) => {
			const name = match.slice(0, match.indexOf("<"));
			return name.endsWith("CustomEvent") ? `CustomEvent<${inner}>` : match;
		});
	}
	return resolvedType;
}

/** Parsea las props de un interface de componente: filtra handlers DOM y arrastra los JSDoc. */
function buildPropLines(blockLines, typeAliases) {
	const propLines = [];
	let inJsdoc = false;
	let jsdocBuffer = [];

	for (const line of blockLines) {
		const trimmed = line.trim();

		// Track JSDoc blocks
		if (trimmed.startsWith("/**")) {
			inJsdoc = true;
			jsdocBuffer = [line];
			if (trimmed.endsWith("*/")) inJsdoc = false;
			continue;
		}
		if (inJsdoc) {
			jsdocBuffer.push(line);
			if (trimmed.endsWith("*/")) inJsdoc = false;
			continue;
		}

		const emitted = renderPropLine(trimmed, typeAliases);
		if (emitted === null) continue;

		// Emit JSDoc + prop
		for (const jl of jsdocBuffer) propLines.push(jl);
		jsdocBuffer = [];
		propLines.push(emitted);
	}
	return propLines;
}

/** Renderiza una línea lógica de prop (`"nombre"?: tipo;`), o null si no es prop o es handler DOM estándar. */
function renderPropLine(trimmed, typeAliases) {
	const propMatch = trimmed.match(/^"(\w+)"(\?)?:\s(.+);$/);
	if (!propMatch) return null;
	const [, propName, , propType] = propMatch;

	// Skip standard DOM event handlers (React.DOMAttributes already provides them)
	// But keep custom Stencil events (onAdc*)
	if (propName.startsWith("on") && !propName.startsWith("onAdc")) return null;

	const resolvedType = resolvePropType(propType, propName, typeAliases);

	// Lowercase del prefijo (onAdcRate → onadcRate) para que React 19 lo cablee a
	// addEventListener("adcRate", ...): React preserva el casing después de "on" y
	// Stencil emite nombres de evento que empiezan en minúscula.
	const emittedName = propName.startsWith("onAdc") ? "on" + propName.charAt(2).toLowerCase() + propName.slice(3) : propName;
	return `\t"${emittedName}"?: ${resolvedType};`;
}

/** Interfaces de componentes del namespace LocalJSX (salvo *Attributes / IntrinsicElements). */
function parseComponentInterfaces(nsBlock, typeAliases) {
	const componentInterfaces = [];
	const ifaceRegex = /\binterface\s+(\w+)\s*\{/g;
	let im;
	while ((im = ifaceRegex.exec(nsBlock)) !== null) {
		const name = im[1];
		if (name.endsWith("Attributes") || name === "IntrinsicElements") continue;

		const braceStart = nsBlock.indexOf("{", im.index + im[0].length - 1);
		const block = extractBraceBlock(nsBlock, braceStart);
		const props = buildPropLines(joinLogicalPropLines(block), typeAliases);
		componentInterfaces.push({ name, props });
	}
	return componentInterfaces;
}

/** Mapa tag → InterfaceName del interface IntrinsicElements. */
function parseTagMap(nsBlock) {
	/** @type {Map<string, string>} */
	const tagMap = new Map();
	const ieStart = nsBlock.indexOf("interface IntrinsicElements");
	if (ieStart === -1) return tagMap;

	const ieBlock = extractBraceBlock(nsBlock, nsBlock.indexOf("{", ieStart));
	// Match: "adc-xxx": Omit<AdcXxx, ... or "adc-xxx": AdcXxx;
	// `[ \t]+` (indentación) en vez de `\s+`: con la flag `m`, `\s+` cruza los
	// `\n` y reintenta desde cada inicio de línea en blanco (S8786).
	const tagRegex = /^[ \t]+"(adc-[\w-]+)":\s(?:Omit<(\w+),|(\w+)\b)/gm;
	let tm;
	while ((tm = tagRegex.exec(ieBlock)) !== null) {
		tagMap.set(tm[1], tm[2] || tm[3]);
	}
	return tagMap;
}

// ─── Output rendering ───

function renderOutput(libPath, { typeDefs, extraDefs, componentInterfaces, tagMap }) {
	let out = `/* eslint-disable @typescript-eslint/no-namespace */
/**
 * AUTO-GENERATED by scripts/generate-react-jsx.mjs — Do not edit manually.
 * Source: src/components.d.ts (Stencil compiler output)
 *
 * Typed React JSX declarations for all adc-* web components.
 * Re-run after adding/modifying Stencil components:
 *   node scripts/generate-react-jsx.mjs ${libPath}
 */

import "react";
`;

	if (typeDefs.size > 0 || extraDefs.length > 0) {
		out += `\n// ─── Custom types (inlined from Stencil component sources) ───\n\n`;
		for (const def of extraDefs) out += `${def}\n\n`;
		for (const [, def] of typeDefs) out += `export ${def}\n\n`;
	}

	out += `// ─── Web component base props ───

/** eslint-disable-next-line @typescript-eslint/no-empty-object-type */
type WCProps<T = {}> = T & React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
	class?: string;
	key?: React.Key;
} & Record<string, any>;

// ─── Component prop interfaces ───
`;

	for (const { name, props } of componentInterfaces) {
		if (props.length === 0) {
			out += `\ntype ${name}Props = {};\n`;
		} else {
			out += `\ninterface ${name}Props {\n${props.join("\n")}\n}\n`;
		}
	}

	out += `
// ─── React JSX IntrinsicElements ───

declare module "react" {
\tnamespace JSX {
\t\tinterface IntrinsicElements {\n`;

	for (const [tag, iface] of tagMap) {
		out += `\t\t\t"${tag}": WCProps<${iface}Props>;\n`;
	}

	out += `\t\t}
\t}
}
`;
	return out;
}

// ─── Main generator ───

function generate(libPath) {
	const absLib = resolveWithinRoot(libPath, ROOT);
	const dtsPath = resolve(absLib, "src/components.d.ts");

	if (!existsSync(dtsPath)) {
		console.log(`⏭  Skipping ${libPath} — no src/components.d.ts`);
		return;
	}

	const content = readFileSync(dtsPath, "utf-8");

	// 1. Tipos custom importados por el d.ts + resolución recursiva de referencias
	const exportRegistry = buildExportRegistry(resolve(absLib, "src"));
	const typeImports = collectTypeImports(content.split("\n"));
	const { typeAliases, typeDefs, extraDefs } = extractImportedTypeDefs(absLib, typeImports);
	resolveReferencedTypes(typeDefs, extraDefs, exportRegistry);
	pullLocalTypes(absLib, typeImports, typeDefs, extraDefs);

	// 2. Namespace LocalJSX → interfaces de componentes + mapa de tags
	const nsMatch = content.match(/declare\s+namespace\s+LocalJSX\s*\{/);
	if (!nsMatch) {
		console.log(`⏭  Skipping ${libPath} — no LocalJSX namespace`);
		return;
	}
	const nsBlock = extractBraceBlock(content, content.indexOf("{", nsMatch.index));
	const componentInterfaces = parseComponentInterfaces(nsBlock, typeAliases);
	const tagMap = parseTagMap(nsBlock);

	// 3. Render + write
	const out = renderOutput(libPath, { typeDefs, extraDefs, componentInterfaces, tagMap });
	const outPath = resolve(absLib, "utils/react-jsx.ts");
	writeFileSync(outPath, out, "utf-8");
	console.log(`✅ Generated ${outPath}`);
}

// ─── CLI ───

const ALL_LIBS = [
	"src/apps/public/00-adc-ui-library",
	"src/apps/test/00-web-ui-library",
	"src/apps/test/00-web-ui-library-mobile",
];

const arg = process.argv[2];

try {
	if (arg === "--all") {
		for (const lib of ALL_LIBS) generate(lib);
	} else {
		generate(arg || ALL_LIBS[0]);
	}
} catch (err) {
	console.error(`Error: ${err.message}`);
	process.exit(1);
}
