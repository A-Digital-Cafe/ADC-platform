import type { Align, CalloutTone, MarkdownBlock } from "./markdown-blocks.js";

/**
 * Parsers por tipo de bloque para `markdownToBlocks` (uno por construcción
 * markdown). Cada `try*` recibe el estado del cursor y, si reconoce el bloque
 * en la línea actual, lo consume (avanza `state.i`, hace push del bloque) y
 * devuelve `true`; si no, devuelve `false` sin tocar nada.
 */

// Operan sobre líneas ya trimmeadas. Los bordes entre cuantificadores usan
// clases disjuntas (`[ \t]` vs `\S`/`$`) para que el matching sea lineal:
// `\s+(.*)$` tiene backtracking super-lineal (typescript:S8786) porque `\s`,
// `.` y `$` se solapan cuando el input trae `\n` intermedios.
const HEADING_RE = /^(#{1,6})[ \t]+(\S.*|)$/;
const FENCE_RE = /^```(\S*)\s*$/;
const UNORDERED_ITEM_RE = /^[-*][ \t]+(?!\[[ xX]\][ \t])(\S.*|)$/;
const ORDERED_ITEM_RE = /^(\d+)[.)][ \t]+(\S.*|)$/;
const CHECKBOX_RE = /^[-*][ \t]+\[([ xX])\][ \t]+(\S.*|)$/;
const DIVIDER_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const CALLOUT_RE = /^\[!(info|warning|success|error)\][ \t]*(\S.*|)$/i;

/** Cursor del parser: líneas, posición, bloques emitidos y párrafo en curso. */
export interface ParserState {
	lines: string[];
	i: number;
	blocks: MarkdownBlock[];
	paragraph: string[];
}

/** Cierra el párrafo acumulado (si hay) emitiéndolo como bloque. */
export function flushParagraph(state: ParserState): void {
	if (state.paragraph.length === 0) return;
	state.blocks.push({ type: "paragraph", text: state.paragraph.join("\n") });
	state.paragraph = [];
}

/** Slug para anclas de encabezados: `Mi Sección` → `mi-seccion`. */
function slugify(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replaceAll(/[̀-ͯ]/g, "")
		.replaceAll(/[^a-z0-9\s-]/g, "")
		.trim()
		.replaceAll(/\s+/g, "-");
}

function isTableRow(line: string): boolean {
	return line.startsWith("|") && line.endsWith("|") && line.length > 1;
}

function splitTableRow(line: string): string[] {
	return line
		.slice(1, -1)
		.split("|")
		.map((cell) => cell.trim());
}

/** `|:---|:--:|---:|` → alineaciones por columna, o `null` si no es separador. */
function parseTableSeparator(line: string): Align[] | null {
	if (!isTableRow(line)) return null;
	const cells = splitTableRow(line);
	const aligns: Align[] = [];
	for (const cell of cells) {
		if (!/^:?-{2,}:?$/.test(cell)) return null;
		if (cell.startsWith(":") && cell.endsWith(":")) aligns.push("center");
		else if (cell.endsWith(":")) aligns.push("right");
		else aligns.push("left");
	}
	return aligns;
}

/** Código cercado: consumir hasta el cierre (o EOF). */
function tryCode(state: ParserState, trimmed: string): boolean {
	const fence = FENCE_RE.exec(trimmed);
	if (!fence) return false;
	flushParagraph(state);
	const language = fence[1] || undefined;
	const content: string[] = [];
	state.i++;
	while (state.i < state.lines.length && !FENCE_RE.test(state.lines[state.i].trim())) {
		content.push(state.lines[state.i]);
		state.i++;
	}
	state.i++; // saltar el cierre
	state.blocks.push({ type: "code", language, content: content.join("\n") });
	return true;
}

function tryHeading(state: ParserState, trimmed: string): boolean {
	const heading = HEADING_RE.exec(trimmed);
	if (!heading) return false;
	flushParagraph(state);
	const text = heading[2].trim();
	state.blocks.push({ type: "heading", level: heading[1].length, text, id: slugify(text) || undefined });
	state.i++;
	return true;
}

function tryDivider(state: ParserState, trimmed: string): boolean {
	if (!DIVIDER_RE.test(trimmed)) return false;
	flushParagraph(state);
	state.blocks.push({ type: "divider" });
	state.i++;
	return true;
}

/** Cita o callout (`> [!tone] ...`): consumir líneas `>` consecutivas. */
function tryQuoteOrCallout(state: ParserState, trimmed: string): boolean {
	if (!trimmed.startsWith(">")) return false;
	flushParagraph(state);
	const quoteLines: string[] = [];
	while (state.i < state.lines.length && state.lines[state.i].trim().startsWith(">")) {
		quoteLines.push(state.lines[state.i].trim().replace(/^>\s?/, ""));
		state.i++;
	}
	const callout = CALLOUT_RE.exec(quoteLines[0] || "");
	if (callout) {
		const rest = [callout[2], ...quoteLines.slice(1)].filter(Boolean).join("\n");
		state.blocks.push({ type: "callout", tone: callout[1].toLowerCase() as CalloutTone, role: "note", text: rest });
	} else {
		state.blocks.push({ type: "quote", text: quoteLines.join("\n") });
	}
	return true;
}

/** Checkboxes: un bloque por ítem (así los modela el renderer). */
function tryCheckboxes(state: ParserState, trimmed: string): boolean {
	if (!CHECKBOX_RE.test(trimmed)) return false;
	flushParagraph(state);
	let checkbox: RegExpExecArray | null;
	while (state.i < state.lines.length && (checkbox = CHECKBOX_RE.exec(state.lines[state.i].trim()))) {
		state.blocks.push({ type: "checkbox", checked: checkbox[1] !== " ", text: checkbox[2] });
		state.i++;
	}
	return true;
}

function tryUnorderedList(state: ParserState, trimmed: string): boolean {
	if (!UNORDERED_ITEM_RE.test(trimmed)) return false;
	flushParagraph(state);
	const items: string[] = [];
	let item: RegExpExecArray | null;
	while (state.i < state.lines.length && (item = UNORDERED_ITEM_RE.exec(state.lines[state.i].trim()))) {
		items.push(item[1]);
		state.i++;
	}
	state.blocks.push({ type: "list", ordered: false, items });
	return true;
}

function tryOrderedList(state: ParserState, trimmed: string): boolean {
	const orderedFirst = ORDERED_ITEM_RE.exec(trimmed);
	if (!orderedFirst) return false;
	flushParagraph(state);
	const start = Number.parseInt(orderedFirst[1], 10);
	const items: string[] = [];
	let item: RegExpExecArray | null;
	while (state.i < state.lines.length && (item = ORDERED_ITEM_RE.exec(state.lines[state.i].trim()))) {
		items.push(item[2]);
		state.i++;
	}
	state.blocks.push({ type: "list", ordered: true, items, start: start === 1 ? undefined : start });
	return true;
}

/** Tabla: fila de cabecera + separador obligatorio. */
function tryTable(state: ParserState, trimmed: string): boolean {
	if (!isTableRow(trimmed) || state.i + 1 >= state.lines.length) return false;
	const columnAlign = parseTableSeparator(state.lines[state.i + 1].trim());
	if (!columnAlign) return false;
	flushParagraph(state);
	const header = splitTableRow(trimmed);
	const rows: string[][] = [];
	state.i += 2;
	while (state.i < state.lines.length && isTableRow(state.lines[state.i].trim())) {
		rows.push(splitTableRow(state.lines[state.i].trim()));
		state.i++;
	}
	state.blocks.push({ type: "table", header, rows, columnAlign });
	return true;
}

/** En orden de precedencia (igual que el if/else original del parser). */
export const BLOCK_PARSERS: ReadonlyArray<(state: ParserState, trimmed: string) => boolean> = [
	tryCode,
	tryHeading,
	tryDivider,
	tryQuoteOrCallout,
	tryCheckboxes,
	tryUnorderedList,
	tryOrderedList,
	tryTable,
];
