/**
 * Parser de Markdown a bloques ADC (`adc-blocks-renderer`).
 *
 * Cubre el subconjunto necesario para documentos estáticos (tutoriales, ayuda):
 * encabezados `#`–`######`, párrafos, listas (`-`, `1.`), checkboxes (`- [x]`),
 * código cercado (``` ```), citas (`>`), callouts (`> [!info|warning|success|error]`),
 * tablas (`| a | b |`) y divisores (`---`). El formato inline (`**bold**`,
 * `*italic*`, `` `code` ``, `[texto](url)`) NO se procesa aquí: lo resuelve
 * `adc-inline-tokens` al renderizar — incluidos los chips `adc-platform-link`.
 *
 * Convención: el título del documento vive en metadatos externos (ej:
 * `tutorials/index.json`), no como `#` dentro del markdown.
 */

type Align = "left" | "center" | "right";
type CalloutTone = "info" | "warning" | "success" | "error";

/** Bloque producido por el parser; estructuralmente compatible con `Block` de `adc-blocks-renderer`. */
export interface MarkdownBlock {
	type: "heading" | "paragraph" | "list" | "code" | "callout" | "quote" | "table" | "divider" | "checkbox";
	level?: number;
	id?: string;
	text?: string;
	checked?: boolean;
	ordered?: boolean;
	items?: string[];
	start?: number;
	language?: string;
	content?: string;
	tone?: CalloutTone;
	role?: "note" | "status" | "alert";
	header?: string[];
	rows?: string[][];
	columnAlign?: Align[];
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^```(\S*)\s*$/;
const UNORDERED_ITEM_RE = /^[-*]\s+(?!\[[ xX]\]\s)(.*)$/;
const ORDERED_ITEM_RE = /^(\d+)[.)]\s+(.*)$/;
const CHECKBOX_RE = /^[-*]\s+\[([ xX])\]\s+(.*)$/;
const DIVIDER_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const CALLOUT_RE = /^\[!(info|warning|success|error)\]\s*(.*)$/i;

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

/**
 * Convierte un documento markdown en bloques listos para `adc-blocks-renderer`.
 * Es tolerante: cualquier línea no reconocida se acumula como párrafo.
 */
export function markdownToBlocks(markdown: string): MarkdownBlock[] {
	const lines = (markdown || "").replaceAll("\r\n", "\n").split("\n");
	const blocks: MarkdownBlock[] = [];
	let paragraph: string[] = [];

	const flushParagraph = () => {
		if (paragraph.length === 0) return;
		blocks.push({ type: "paragraph", text: paragraph.join("\n") });
		paragraph = [];
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();

		if (!trimmed) {
			flushParagraph();
			i++;
			continue;
		}

		// Código cercado: consumir hasta el cierre (o EOF).
		const fence = FENCE_RE.exec(trimmed);
		if (fence) {
			flushParagraph();
			const language = fence[1] || undefined;
			const content: string[] = [];
			i++;
			while (i < lines.length && !FENCE_RE.test(lines[i].trim())) {
				content.push(lines[i]);
				i++;
			}
			i++; // saltar el cierre
			blocks.push({ type: "code", language, content: content.join("\n") });
			continue;
		}

		const heading = HEADING_RE.exec(trimmed);
		if (heading) {
			flushParagraph();
			const text = heading[2].trim();
			blocks.push({ type: "heading", level: heading[1].length, text, id: slugify(text) || undefined });
			i++;
			continue;
		}

		if (DIVIDER_RE.test(trimmed)) {
			flushParagraph();
			blocks.push({ type: "divider" });
			i++;
			continue;
		}

		// Cita o callout (`> [!tone] ...`): consumir líneas `>` consecutivas.
		if (trimmed.startsWith(">")) {
			flushParagraph();
			const quoteLines: string[] = [];
			while (i < lines.length && lines[i].trim().startsWith(">")) {
				quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
				i++;
			}
			const callout = CALLOUT_RE.exec(quoteLines[0] || "");
			if (callout) {
				const rest = [callout[2], ...quoteLines.slice(1)].filter(Boolean).join("\n");
				blocks.push({ type: "callout", tone: callout[1].toLowerCase() as CalloutTone, role: "note", text: rest });
			} else {
				blocks.push({ type: "quote", text: quoteLines.join("\n") });
			}
			continue;
		}

		// Checkboxes: un bloque por ítem (así los modela el renderer).
		if (CHECKBOX_RE.test(trimmed)) {
			flushParagraph();
			let checkbox: RegExpExecArray | null;
			while (i < lines.length && (checkbox = CHECKBOX_RE.exec(lines[i].trim()))) {
				blocks.push({ type: "checkbox", checked: checkbox[1] !== " ", text: checkbox[2] });
				i++;
			}
			continue;
		}

		if (UNORDERED_ITEM_RE.test(trimmed)) {
			flushParagraph();
			const items: string[] = [];
			let item: RegExpExecArray | null;
			while (i < lines.length && (item = UNORDERED_ITEM_RE.exec(lines[i].trim()))) {
				items.push(item[1]);
				i++;
			}
			blocks.push({ type: "list", ordered: false, items });
			continue;
		}

		const orderedFirst = ORDERED_ITEM_RE.exec(trimmed);
		if (orderedFirst) {
			flushParagraph();
			const start = Number.parseInt(orderedFirst[1], 10);
			const items: string[] = [];
			let item: RegExpExecArray | null;
			while (i < lines.length && (item = ORDERED_ITEM_RE.exec(lines[i].trim()))) {
				items.push(item[2]);
				i++;
			}
			blocks.push({ type: "list", ordered: true, items, start: start === 1 ? undefined : start });
			continue;
		}

		// Tabla: fila de cabecera + separador obligatorio.
		if (isTableRow(trimmed) && i + 1 < lines.length) {
			const columnAlign = parseTableSeparator(lines[i + 1].trim());
			if (columnAlign) {
				flushParagraph();
				const header = splitTableRow(trimmed);
				const rows: string[][] = [];
				i += 2;
				while (i < lines.length && isTableRow(lines[i].trim())) {
					rows.push(splitTableRow(lines[i].trim()));
					i++;
				}
				blocks.push({ type: "table", header, rows, columnAlign });
				continue;
			}
		}

		paragraph.push(trimmed);
		i++;
	}

	flushParagraph();
	return blocks;
}
