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

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(__filename).replace(/\/scripts$/, "");

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

// ─── Main generator ───

function generate(libPath) {
	const absLib = resolve(ROOT, libPath);
	const dtsPath = resolve(absLib, "src/components.d.ts");

	if (!existsSync(dtsPath)) {
		console.log(`⏭  Skipping ${libPath} — no src/components.d.ts`);
		return;
	}

	const content = readFileSync(dtsPath, "utf-8");
	const lines = content.split("\n");

	// Global registry of all exported interfaces/types in the library's src/
	const exportRegistry = buildExportRegistry(resolve(absLib, "src"));

	// ============================================================
	// 1. Collect custom type imports (from .tsx sources, not @stencil)
	// ============================================================

	/** @type {Map<string, {original: string, sourceRel: string}>} alias → info */
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

	// Deduplicate: AccessMenuItem1 is same as AccessMenuItem, just aliased
	// We'll map aliases → canonical name for later replacement
	/** @type {Map<string, string>} alias → canonical */
	const typeAliases = new Map();
	/** @type {Map<string, string>} canonical → definition */
	const typeDefs = new Map();
	/** @type {string[]} extra local types to emit (e.g. Align) */
	const extraDefs = [];

	for (const [alias, { original, sourceRel }] of typeImports) {
		// Resolve source file
		const basePath = sourceRel.replace(/^\.\//, "").replace(/\.js$/, "");
		let srcFile = resolve(absLib, "src", basePath + ".tsx");
		if (!existsSync(srcFile)) srcFile = resolve(absLib, "src", basePath + ".ts");
		if (!existsSync(srcFile)) continue;

		// Check if this alias maps to an already-extracted type (dedup)
		if (typeDefs.has(original)) {
			if (alias !== original) typeAliases.set(alias, original);
			continue;
		}

		const srcContent = readFileSync(srcFile, "utf-8");
		const def = extractInterface(srcContent, original);
		if (!def) {
			// Try as exported type alias
			const typeDef = extractExportedType(srcContent, original);
			if (typeDef) {
				extraDefs.push(`export ${typeDef}`);
				if (alias !== original) typeAliases.set(alias, original);
			}
			continue;
		}

		typeDefs.set(original, def);
		if (alias !== original) typeAliases.set(alias, original);
	}

	// Recursively resolve any referenced types still missing.
	const builtIns = new Set([
		"string", "number", "boolean", "any", "unknown", "void", "null",
		"undefined", "never", "object", "Array", "Record", "Map", "Set",
		"Promise", "Partial", "Required", "Readonly", "Pick", "Omit",
		"true", "false", "Event", "MouseEvent", "KeyboardEvent",
		"HTMLElement", "Element", "EventEmitter", "CustomEvent",
	]);
	const refRegex = /(?<!\w)([A-Z][a-zA-Z0-9]+)(?=[\s;[\]|&,?>)}])/g;

	const queue = [...typeDefs.entries()].map(([n, d]) => ({ name: n, def: d }));
	while (queue.length > 0) {
		const { def } = queue.shift();
		let rm;
		while ((rm = refRegex.exec(def)) !== null) {
			const ref = rm[1];
			if (builtIns.has(ref) || typeDefs.has(ref) || extraDefs.some(d => d.includes(`type ${ref} =`) || d.includes(`type ${ref}=`))) continue;

			// Try the registry: any exported interface/type in the lib
			const regContent = exportRegistry.get(ref);
			if (regContent) {
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
					continue;
				}
			}
		}
		refRegex.lastIndex = 0;
	}

	// Also pull in non-exported local types from the original imported source files
	for (const [, { sourceRel }] of typeImports) {
		const basePath = sourceRel.replace(/^\.\//, "").replace(/\.js$/, "");
		let srcFile = resolve(absLib, "src", basePath + ".tsx");
		if (!existsSync(srcFile)) srcFile = resolve(absLib, "src", basePath + ".ts");
		if (!existsSync(srcFile)) continue;
		const srcContent = readFileSync(srcFile, "utf-8");
		for (const [, def] of typeDefs) {
			let rm;
			while ((rm = refRegex.exec(def)) !== null) {
				const ref = rm[1];
				if (builtIns.has(ref) || typeDefs.has(ref) || extraDefs.some(d => d.includes(`type ${ref} =`) || d.includes(`type ${ref}=`))) continue;
				const localDef = extractLocalType(srcContent, ref);
				if (localDef) extraDefs.push(localDef);
			}
			refRegex.lastIndex = 0;
		}
	}

	// ============================================================
	// 2. Parse LocalJSX namespace
	// ============================================================

	const nsMatch = content.match(/declare\s+namespace\s+LocalJSX\s*\{/);
	if (!nsMatch) {
		console.log(`⏭  Skipping ${libPath} — no LocalJSX namespace`);
		return;
	}

	const nsOpenBrace = content.indexOf("{", nsMatch.index);
	const nsBlock = extractBraceBlock(content, nsOpenBrace);

	// Parse component interfaces (skip *Attributes, IntrinsicElements, OneOf)
	/** @type {Array<{name: string, body: string}>} */
	const componentInterfaces = [];

	const ifaceRegex = /\binterface\s+(\w+)\s*\{/g;
	let im;
	while ((im = ifaceRegex.exec(nsBlock)) !== null) {
		const name = im[1];
		if (name.endsWith("Attributes") || name === "IntrinsicElements") continue;

		const braceStart = nsBlock.indexOf("{", im.index + im[0].length - 1);
		const block = extractBraceBlock(nsBlock, braceStart);

		// Parse props line by line, stripping event handlers (on* props)
		// Pre-process: join multi-line prop declarations into single logical lines.
		// A prop spans multiple lines when its type uses inline `{ ... }` or other
		// brace-enclosed structures. We accumulate until braces are balanced and
		// the line ends with `;`.
		// The block string includes the surrounding `{` and `}` — strip them first.
		const innerBlock = block.replace(/^\s*\{/, "").replace(/\}\s*$/, "");
		const rawLines = innerBlock.split("\n");
		const blockLines = [];
		let pending = "";
		let pendingDepth = 0;
		for (const rawLine of rawLines) {
			const trimmedRaw = rawLine.trim();
			// JSDoc passes through as-is to keep buffer tracking simple
			if (
				pending === "" &&
				(trimmedRaw.startsWith("/**") || trimmedRaw.startsWith("*") || trimmedRaw.endsWith("*/"))
			) {
				blockLines.push(rawLine);
				continue;
			}
			if (pending === "") {
				// Start of a logical prop line
				pending = rawLine;
				pendingDepth = 0;
				for (const ch of rawLine) {
					if (ch === "{") pendingDepth++;
					else if (ch === "}") pendingDepth--;
				}
				if (pendingDepth <= 0 && trimmedRaw.endsWith(";")) {
					blockLines.push(pending);
					pending = "";
					pendingDepth = 0;
				}
			} else {
				pending += " " + trimmedRaw;
				for (const ch of rawLine) {
					if (ch === "{") pendingDepth++;
					else if (ch === "}") pendingDepth--;
				}
				if (pendingDepth <= 0 && trimmedRaw.endsWith(";")) {
					blockLines.push(pending);
					pending = "";
					pendingDepth = 0;
				}
			}
		}
		if (pending) blockLines.push(pending);

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

			// Match property line: "propName"?: type;
			const propMatch = trimmed.match(/^"(\w+)"(\?)?:\s(.+);$/);
			if (!propMatch) continue;

			const [, propName, , propType] = propMatch;

			// Skip standard DOM event handlers (React.DOMAttributes already provides them)
			// But keep custom Stencil events (onAdc*)
			if (propName.startsWith("on") && !propName.startsWith("onAdc")) continue;

			// Replace type aliases (e.g. AccessMenuItem1 → AccessMenuItem)
			let resolvedType = propType;
			for (const [alias, canonical] of typeAliases) {
				resolvedType = resolvedType.replaceAll(new RegExp(String.raw`\b${alias}\b`, "g"), canonical);
			}

			// For Stencil custom events, replace ComponentCustomEvent<T> with CustomEvent<T>
			// and lowercase the prefix (onAdcRate → onadcRate) so React 19 wires it to
			// addEventListener("adcRate", ...). React preserves casing after "on", and
			// Stencil emits event names starting with lowercase (e.g. "adcRate").
			let emittedName = propName;
			if (propName.startsWith("onAdc")) {
				resolvedType = resolvedType.replaceAll(/\w+CustomEvent<([^>]+)>/g, "CustomEvent<$1>");
				emittedName = "on" + propName.charAt(2).toLowerCase() + propName.slice(3);
			}

			// Emit JSDoc + prop
			for (const jl of jsdocBuffer) propLines.push(jl);
			jsdocBuffer = [];
			propLines.push(`\t"${emittedName}"?: ${resolvedType};`);
		}

		componentInterfaces.push({ name, props: propLines });
	}

	// ============================================================
	// 3. Extract tag → interface mapping from IntrinsicElements
	// ============================================================

	/** @type {Map<string, string>} tag → InterfaceName */
	const tagMap = new Map();
	const ieStart = nsBlock.indexOf("interface IntrinsicElements");
	if (ieStart !== -1) {
		const ieBrace = nsBlock.indexOf("{", ieStart);
		const ieBlock = extractBraceBlock(nsBlock, ieBrace);

		// Match: "adc-xxx": Omit<AdcXxx, ... or "adc-xxx": AdcXxx;
		const tagRegex = /^\s+"(adc-[\w-]+)":\s(?:Omit<(\w+),|(\w+)\b)/gm;
		let tm;
		while ((tm = tagRegex.exec(ieBlock)) !== null) {
			tagMap.set(tm[1], tm[2] || tm[3]);
		}
	}

	// ============================================================
	// 4. Generate output
	// ============================================================

	const hasCustomTypes = typeDefs.size > 0 || extraDefs.length > 0;

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

	if (hasCustomTypes) {
		out += `\n// ─── Custom types (inlined from Stencil component sources) ───\n\n`;
		for (const def of extraDefs) out += `${def}\n\n`;
		for (const [, def] of typeDefs) out += `export ${def}\n\n`;
	}

	out += `// ─── Web component base props ───

/** eslint-disable-next-line @typescript-eslint/no-empty-object-type */
type WCProps<T = {}> = T & {
\tchildren?: React.ReactNode;
\tid?: string;
\tclass?: string;
\tclassName?: string;
\tstyle?: React.CSSProperties | string;
\tref?: React.Ref<HTMLElement>;
\tslot?: string;
\tkey?: React.Key;
} & React.DOMAttributes<HTMLElement>;

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

if (arg === "--all") {
	for (const lib of ALL_LIBS) generate(lib);
} else {
	generate(arg || ALL_LIBS[0]);
}
