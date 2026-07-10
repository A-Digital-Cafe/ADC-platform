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

import { BLOCK_PARSERS, flushParagraph, type ParserState } from "./markdown-block-parsers.js";

export type Align = "left" | "center" | "right";
export type CalloutTone = "info" | "warning" | "success" | "error";

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

/**
 * Convierte un documento markdown en bloques listos para `adc-blocks-renderer`.
 * Es tolerante: cualquier línea no reconocida se acumula como párrafo.
 * La lógica por tipo de bloque vive en `markdown-block-parsers.ts`.
 */
export function markdownToBlocks(markdown: string): MarkdownBlock[] {
	const state: ParserState = {
		lines: (markdown || "").replaceAll("\r\n", "\n").split("\n"),
		i: 0,
		blocks: [],
		paragraph: [],
	};

	while (state.i < state.lines.length) {
		const trimmed = state.lines[state.i].trim();

		if (!trimmed) {
			flushParagraph(state);
			state.i++;
			continue;
		}

		if (BLOCK_PARSERS.some((tryParse) => tryParse(state, trimmed))) continue;

		state.paragraph.push(trimmed);
		state.i++;
	}

	flushParagraph(state);
	return state.blocks;
}

/**
 * @public Serializa bloques de vuelta a Markdown (inverso de `markdownToBlocks`).
 * El texto inline se persiste tal cual (los marks ya viven como `**bold**` etc.).
 * Bloques desconocidos (ej: `attachment`) se omiten.
 */
export function blocksToMarkdown(blocks: MarkdownBlock[]): string {
	const out: string[] = [];

	for (const block of blocks) {
		switch (block.type) {
			case "heading":
				out.push(`${"#".repeat(Math.min(Math.max(block.level ?? 1, 1), 6))} ${block.text ?? ""}`);
				break;
			case "paragraph":
				out.push(block.text ?? "");
				break;
			case "list": {
				const start = block.start ?? 1;
				out.push((block.items ?? []).map((item, i) => (block.ordered ? `${start + i}. ${item}` : `- ${item}`)).join("\n"));
				break;
			}
			case "checkbox":
				out.push(`- [${block.checked ? "x" : " "}] ${block.text ?? ""}`);
				break;
			case "code":
				out.push(`\`\`\`${block.language ?? ""}\n${block.content ?? ""}\n\`\`\``);
				break;
			case "quote":
				out.push(
					(block.text ?? "")
						.split("\n")
						.map((line) => `> ${line}`)
						.join("\n")
				);
				break;
			case "callout": {
				const lines = (block.text ?? "").split("\n");
				out.push([`> [!${block.tone ?? "info"}] ${lines[0] ?? ""}`, ...lines.slice(1).map((line) => `> ${line}`)].join("\n"));
				break;
			}
			case "table": {
				const header = block.header ?? [];
				const aligns: Align[] = block.columnAlign ?? header.map(() => "left");
				const separators: Record<Align, string> = { left: "---", center: ":---:", right: "---:" };
				const sep = aligns.map((a) => separators[a]);
				const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
				out.push([row(header), row(sep), ...(block.rows ?? []).map(row)].join("\n"));
				break;
			}
			case "divider":
				out.push("---");
				break;
			default:
				break;
		}
	}

	return out.join("\n\n") + (out.length ? "\n" : "");
}
