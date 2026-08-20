/**
 * Genera el PDF congelado de cada documento legal: `public/legal/<id>-<version>.pdf`.
 *
 * **El HTML es la versión oficial; el PDF es una copia fiel para los registros de quien acepta.**
 * Esa jerarquía no es un detalle de redacción: si los dos formatos divergieran y ambos se
 * presentaran como oficiales, la ambigüedad se interpreta a favor del consumidor (art. 1095 CCyC).
 * Por eso el PDF se **deriva** del mismo componente React que se publica —no de una copia
 * mantenida a mano— y lleva impresos la versión, la vigencia y el `contentHash` del fuente.
 *
 * **Un PDF ya publicado nunca se regenera.** Un archivo congelado que cambia deja de probar nada,
 * así que el script salta los que ya existen. Rehacer uno es una decisión consciente y con rastro:
 * se pide desde la tab «Legales» del panel de administración, que exige un motivo y lo asienta en
 * el audit log antes de borrar el archivo.
 *
 * Normalmente no hace falta invocarlo: `LegalDocsService` lo corre al arrancar (con `--json`, para
 * asentar qué generó) y cuando se lo pide el panel. `bun run build:legal` queda como salida manual.
 */

// El componente se renderiza fuera del navegador: estos globales existen sólo ahí y el hook de
// i18n los toca al montar. Van antes de cualquier import del árbol de la app.
const browserish = globalThis as unknown as Record<string, unknown>;
browserish.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
browserish.navigator ??= { language: "es-AR" };
browserish.window ??= globalThis;

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderPdf } from "./lib/pdf-writer.mjs";
import { LEGAL_DOCUMENTS, type LegalDocument } from "../src/common/utils/legal-docs.ts";
import { TermsPage } from "../presets/help/apps/help/src/pages/TermsPage.tsx";
import { PrivacyPage } from "../presets/help/apps/help/src/pages/PrivacyPage.tsx";
import { CookiesPage } from "../presets/help/apps/help/src/pages/CookiesPage.tsx";
import { DpaPage } from "../presets/help/apps/help/src/pages/DpaPage.tsx";

const OUT_DIR = path.join(import.meta.dir, "..", "presets", "help", "apps", "help", "public", "legal");

const PAGES: Record<string, FunctionComponent> = {
	terms: TermsPage as FunctionComponent,
	privacy: PrivacyPage as FunctionComponent,
	cookies: CookiesPage as FunctionComponent,
	dpa: DpaPage as FunctionComponent,
};

interface Block {
	style: "heading" | "body" | "bullet" | "note" | "meta";
	text: string;
}

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	"#x27": "'",
	"#39": "'",
};

function decodeEntities(s: string): string {
	return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, name: string) => {
		const known = ENTITIES[name];
		if (known) return known;
		if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
		if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
		return whole;
	});
}

const stripTags = (html: string): string =>
	decodeEntities(html.replace(/<[^>]*>/g, " "))
		.replace(/\s+/g, " ")
		.trim();

/**
 * HTML renderado → bloques de texto.
 *
 * Se recorre por elementos de bloque en vez de parsear el árbol entero porque lo único que el PDF
 * necesita conservar es **el texto y su jerarquía**. Las tablas se aplanan a filas separadas por
 * ` | `: se pierde la grilla, no el contenido, y el contenido es lo que obliga.
 */
function htmlToBlocks(html: string): Block[] {
	const blocks: Block[] = [];
	// Las tablas se procesan antes y se sacan del flujo: si no, el barrido de <p>/<li> se comería
	// sus celdas sueltas y saldrían como párrafos huérfanos sin relación entre sí.
	const withoutTables = html.replace(/<table[\s\S]*?<\/table>/g, (table) => {
		for (const row of table.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
			const cells = (row.match(/<t[hd][\s\S]*?<\/t[hd]>/g) ?? []).map(stripTags).filter(Boolean);
			if (cells.length > 0) blocks.push({ style: "bullet", text: cells.join("  |  ") });
		}
		return "";
	});

	const pattern = /<(h[1-6]|p|li|adc-callout)\b([^>]*)>([\s\S]*?)<\/\1>/g;
	const flow: Block[] = [];
	for (const m of withoutTables.matchAll(pattern)) {
		// `data-pdf-omit` marca lo que sólo tiene sentido en la página: hoy el propio enlace de
		// descarga del PDF, que dentro del PDF se referiría a sí mismo.
		if (m[2].includes("data-pdf-omit")) continue;
		const text = stripTags(m[3]);
		if (!text) continue;
		const tag = m[1];
		if (tag === "li") flow.push({ style: "bullet", text });
		else if (tag === "adc-callout") flow.push({ style: "note", text });
		else if (tag === "p") flow.push({ style: "body", text });
		else if (tag === "h1") flow.push({ style: "meta", text });
		else flow.push({ style: "heading", text });
	}

	// Las filas de tabla salen primero por cómo se extrajeron; se dejan al final del flujo para no
	// romper el orden de lectura del resto. Es una aproximación consciente: el PDF es una copia
	// legible del texto, no una maqueta.
	return [...flow, ...blocks];
}

async function exists(file: string): Promise<boolean> {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

async function buildOne(doc: LegalDocument): Promise<"written" | "skipped"> {
	const file = path.join(OUT_DIR, `${doc.id}-${doc.version}.pdf`);
	if (await exists(file)) return "skipped";

	const Component = PAGES[doc.id];
	if (!Component) throw new Error(`No hay componente registrado para el documento "${doc.id}"`);

	const html = renderToStaticMarkup(createElement(Component));
	const blocks = htmlToBlocks(html);
	if (blocks.length < 5) throw new Error(`El render de "${doc.id}" devolvió ${blocks.length} bloques: algo se rompió`);

	// Los documentos informativos (cookies, DPA) no entran en el flujo de aceptación: su vigencia
	// no se predica sobre "cuentas preexistentes" y decir lo contrario en el PDF sería inexacto.
	const effectiveLine = doc.requiresAcceptance
		? `En vigor para cuentas preexistentes desde ${doc.effectiveFrom}. `
		: `Documento informativo versionado; rige desde ${doc.effectiveFrom} (no requiere aceptación individual). `;
	const pdf = renderPdf({
		title: `${doc.label} — versión ${doc.version}`,
		subtitle:
			`Copia fiel de la versión publicada en adigitalcafe.com${doc.href}. ` +
			effectiveLine +
			`La versión oficial es la publicada en el sitio; este PDF es una copia para tus registros. ` +
			`SHA-256 del documento fuente: ${doc.contentHash}`,
		blocks,
		footer: `${doc.label} v${doc.version}`,
	});

	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(file, pdf);
	return "written";
}

// `--json` lo pasa `LegalDocsService`, que corre este script como proceso aparte: sin un resumen
// legible por máquina no podría asentar en el historial qué se generó y qué ya estaba congelado.
const asJson = process.argv.includes("--json");
const written: string[] = [];
const skipped: string[] = [];

for (const doc of Object.values(LEGAL_DOCUMENTS)) {
	const file = `${doc.id}-${doc.version}.pdf`;
	if ((await buildOne(doc as LegalDocument)) === "written") {
		written.push(file);
		console.log(`[legal-pdf] generado ${file}`);
	} else {
		skipped.push(file);
		console.log(`[legal-pdf] ${file} ya existe, no se regenera`);
	}
}
console.log(`[legal-pdf] ${written.length} archivo(s) nuevo(s)`);
if (asJson) console.log(`LEGAL_PDF_JSON ${JSON.stringify({ written, skipped })}`);
