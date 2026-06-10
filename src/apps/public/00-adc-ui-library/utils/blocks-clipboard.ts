/**
 * Portapapeles de bloques ADC en 3 formatos simultáneos: `adc-blocks` (JSON
 * fiel), `text/html` (interoperable) y `text/plain` (fallback). El formato
 * `adc-blocks` permite round-trips sin pérdida entre editores/render; los otros
 * dos hacen que el contenido pegue limpio en apps externas (docs, chats, etc.).
 *
 * Uso típico: `registerBlocksClipboard(el, { getBlocks, onPaste })` engancha los
 * listeners `copy`/`cut`/`paste`. Para botones explícitos, ver
 * `copyBlocksToClipboard` / `pasteBlocksFromClipboard`.
 *
 * El módulo trabaja sobre `BlockData`, una forma estructural laxa compatible con
 * todas las variantes del tipo `Block` del proyecto. Las funciones que devuelven
 * bloques son genéricas para tipar el resultado según el `Block` del consumidor.
 */

/** Forma estructural laxa de un bloque ADC (superset de todas sus variantes). */
export interface BlockData {
	type: string;
	level?: number;
	id?: string;
	align?: string;
	text?: string;
	checked?: boolean;
	marks?: readonly string[];
	ordered?: boolean;
	items?: readonly string[];
	start?: number;
	ariaLabel?: string;
	language?: string;
	content?: string;
	tone?: string;
	role?: string;
	url?: string;
	rel?: readonly string[];
	header?: readonly string[];
	rows?: readonly (readonly string[])[];
	columnAlign?: readonly string[];
	caption?: string;
	rowHeaders?: boolean;
	kind?: string;
	attachmentId?: string;
	fileName?: string;
	mimeType?: string;
	size?: number;
	alt?: string;
}

/** MIME propietario para serializar bloques sin pérdida en el portapapeles. */
export const ADC_BLOCKS_MIME = "application/x-adc-blocks";
/** Variante con prefijo `web ` exigida por el async Clipboard API (Chromium). */
const ADC_BLOCKS_WEB_MIME = `web ${ADC_BLOCKS_MIME}`;

export type ClipboardSource = "adc-blocks" | "html" | "text" | "none";

export interface ClipboardBlocksPayload<B extends BlockData = BlockData> {
	/** Bloques resueltos del mejor formato disponible, o `null` si vacío. */
	blocks: B[] | null;
	/** Texto plano del portapapeles. */
	text: string;
	/** HTML del portapapeles. */
	html: string;
	/** Formato del que provienen los `blocks`. */
	source: ClipboardSource;
}

// ── Serialización ───────────────────────────────────────────────────────────

/** Serializa bloques al formato JSON `adc-blocks`. */
export function serializeBlocks(blocks: readonly BlockData[]): string {
	return JSON.stringify(blocks);
}

/** Parsea JSON `adc-blocks`; devuelve `null` si no es un array de bloques. */
export function deserializeBlocks<B extends BlockData = BlockData>(json: string): B[] | null {
	if (!json) return null;
	try {
		const parsed = JSON.parse(json);
		if (!Array.isArray(parsed)) return null;
		const valid = parsed.filter((b) => b && typeof b === "object" && typeof b.type === "string");
		return valid as B[];
	} catch {
		return null;
	}
}

function escapeHtml(s: string): string {
	return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Markdown inline (`**bold**`, `*italic*`, `` `code` ``) → HTML seguro. */
function inlineMarkdownToHtml(md: string): string {
	return escapeHtml(md)
		.replaceAll(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
		.replaceAll(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
		.replaceAll(/`([^`\n]+?)`/g, "<code>$1</code>");
}

/** Quita marcadores markdown inline para representación en texto plano. */
function stripInlineMarkdown(md: string): string {
	return md
		.replaceAll(/\*\*([^*\n]+?)\*\*/g, "$1")
		.replaceAll(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1$2")
		.replaceAll(/`([^`\n]+?)`/g, "$1");
}

/** Convierte una lista de bloques a HTML interoperable. */
export function blocksToHtml(blocks: readonly BlockData[]): string {
	return blocks.map(blockToHtml).join("");
}

function blockToHtml(b: BlockData): string {
	switch (b.type) {
		case "heading": {
			const level = Math.min(6, Math.max(2, b.level || 2));
			return `<h${level}>${inlineMarkdownToHtml(b.text || "")}</h${level}>`;
		}
		case "paragraph":
			return `<p>${inlineMarkdownToHtml(b.text || "") || "<br>"}</p>`;
		case "checkbox":
			return `<p>${b.checked ? "☑" : "☐"} ${inlineMarkdownToHtml(b.text || "")}</p>`;
		case "list": {
			const tag = b.ordered ? "ol" : "ul";
			const items = (b.items || []).map((it) => `<li>${inlineMarkdownToHtml(it || "")}</li>`).join("");
			return `<${tag}>${items}</${tag}>`;
		}
		case "code": {
			const lang = b.language ? ` class="language-${escapeHtml(b.language)}"` : "";
			return `<pre><code${lang}>${escapeHtml(b.content || "")}</code></pre>`;
		}
		case "quote":
			return `<blockquote>${inlineMarkdownToHtml(b.text || "")}</blockquote>`;
		case "callout":
			return `<blockquote data-tone="${escapeHtml(b.tone || "info")}">${inlineMarkdownToHtml(b.text || "")}</blockquote>`;
		case "table":
			return tableToHtml(b);
		case "divider":
			return "<hr/>";
		case "attachment":
			return `<p>${b.kind === "image" ? "🖼️" : "📎"} ${escapeHtml(b.fileName || "")}</p>`;
		default:
			return "";
	}
}

function tableToHtml(b: BlockData): string {
	const head = (b.header || []).map((h) => `<th>${escapeHtml(h)}</th>`).join("");
	const body = (b.rows || [])
		.map((row) => {
			const cells = row.map((c) => `<td>${escapeHtml(c)}</td>`).join("");
			return `<tr>${cells}</tr>`;
		})
		.join("");
	const caption = b.caption ? `<caption>${escapeHtml(b.caption)}</caption>` : "";
	const headText = head ? `<thead><tr>${head}</tr></thead>` : "";
	return `<table>${caption}${headText}<tbody>${body}</tbody></table>`;
}

/** Convierte una lista de bloques a texto plano legible. */
export function blocksToPlainText(blocks: readonly BlockData[]): string {
	return blocks
		.map(blockToPlainText)
		.filter((s) => s.length > 0)
		.join("\n\n");
}

function blockToPlainText(b: BlockData): string {
	switch (b.type) {
		case "heading":
		case "paragraph":
			return stripInlineMarkdown(b.text || "");
		case "checkbox":
			return `${b.checked ? "[x]" : "[ ]"} ${stripInlineMarkdown(b.text || "")}`;
		case "list":
			return (b.items || [])
				.map((it, i) => {
					const order = b.ordered ? `${i + 1}.` : "-";
					return `${order} ${stripInlineMarkdown(it || "")}`;
				})
				.join("\n");
		case "code":
			return b.content || "";
		case "quote":
		case "callout":
			return stripInlineMarkdown(b.text || "")
				.split("\n")
				.map((l) => `> ${l}`)
				.join("\n");
		case "table": {
			const rows = [b.header || [], ...(b.rows || [])].filter((r) => r.length > 0);
			return rows.map((r) => r.join(" | ")).join("\n");
		}
		case "divider":
			return "---";
		case "attachment":
			return b.fileName || "";
		default:
			return "";
	}
}

// ── Parsing inverso (HTML / texto → bloques) ────────────────────────────────

/** HTML inline → markdown (`<strong>` → `**`, `<em>` → `*`, `<code>` → `` ` ``). */
function inlineHtmlToMarkdown(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").replaceAll("\u200B", "");
	if (node.nodeType !== Node.ELEMENT_NODE) return "";
	const el = node as HTMLElement;
	const tag = el.tagName.toLowerCase();
	if (tag === "br") return "\n";
	const inner = Array.from(el.childNodes).map(inlineHtmlToMarkdown).join("");
	if (tag === "strong" || tag === "b") return inner ? `**${inner}**` : "";
	if (tag === "em" || tag === "i") return inner ? `*${inner}*` : "";
	if (tag === "code") return inner ? `\`${inner}\`` : "";
	return inner;
}

const INLINE_TAGS = new Set(["b", "strong", "i", "em", "u", "s", "code", "span", "a", "br", "font", "sub", "sup", "mark"]);

function detectCodeLanguage(pre: HTMLElement): string | undefined {
	const codeEl = pre.querySelector("code") || pre;
	const cls = codeEl.getAttribute("class") || "";
	const match = /(?:language|lang)-([\w+-]+)/.exec(cls);
	return match ? match[1] : undefined;
}

/**
 * Convierte HTML (string o elemento) en bloques ADC. Sólo reconstruye estructuras
 * conocidas (headings, listas, código, citas, tablas, divisores) y normaliza el
 * resto a párrafos: nunca inyecta HTML crudo, por lo que es seguro frente a
 * contenido externo no confiable.
 */
export function htmlToBlocks<B extends BlockData = BlockData>(html: string | HTMLElement): B[] {
	let root: HTMLElement;
	if (typeof html === "string") {
		const doc = new DOMParser().parseFromString(html, "text/html");
		root = doc.body;
	} else {
		root = html;
	}
	const blocks: BlockData[] = [];
	let inlineBuf: Node[] = [];
	const flushInline = () => {
		if (inlineBuf.length === 0) return;
		const md = inlineBuf.map(inlineHtmlToMarkdown).join("").trim();
		inlineBuf = [];
		if (md) blocks.push({ type: "paragraph", text: md });
	};

	for (const child of Array.from(root.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			if ((child.textContent || "").trim()) inlineBuf.push(child);
			continue;
		}
		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const el = child as HTMLElement;
		const tag = el.tagName.toLowerCase();
		if (INLINE_TAGS.has(tag)) {
			inlineBuf.push(child);
			continue;
		}
		flushInline();
		const block = elementToBlock(el, tag);
		if (block) blocks.push(block);
	}
	flushInline();
	return blocks as B[];
}

function elementToBlock(el: HTMLElement, tag: string): BlockData | null {
	if (/^h[1-6]$/.test(tag)) {
		const level = Math.min(6, Math.max(2, Number(tag.slice(1))));
		return { type: "heading", level, text: inlineHtmlToMarkdown(el).trim() };
	}
	if (tag === "ul" || tag === "ol") {
		const items = Array.from(el.querySelectorAll(":scope > li")).map((li) => inlineHtmlToMarkdown(li).trim());
		return { type: "list", ordered: tag === "ol", items };
	}
	if (tag === "pre") {
		return { type: "code", language: detectCodeLanguage(el) || "text", content: el.textContent || "" };
	}
	if (tag === "blockquote") {
		return { type: "quote", text: inlineHtmlToMarkdown(el).trim() };
	}
	if (tag === "hr") {
		return { type: "divider" };
	}
	if (tag === "table") {
		return tableElementToBlock(el);
	}
	// p / div / desconocidos → párrafo (texto inline; nunca HTML crudo).
	const md = inlineHtmlToMarkdown(el).trim();
	return md ? { type: "paragraph", text: md } : null;
}

function tableElementToBlock(el: HTMLElement): BlockData {
	const header = Array.from(el.querySelectorAll(":scope > thead th, :scope > thead td")).map((c) => c.textContent?.trim() || "");
	const rows = Array.from(el.querySelectorAll(":scope > tbody > tr, :scope > tr")).map((tr) =>
		Array.from(tr.querySelectorAll("td, th")).map((c) => c.textContent?.trim() || "")
	);
	return { type: "table", header, rows };
}

/** Convierte texto plano en párrafos (bloques separados por línea en blanco). */
export function textToBlocks<B extends BlockData = BlockData>(text: string): B[] {
	return text
		.split(/\n{2,}/)
		.map((chunk) => chunk.trim())
		.filter((chunk) => chunk.length > 0)
		.map((chunk) => ({ type: "paragraph", text: chunk })) as B[];
}

// ── DataTransfer (eventos copy/cut/paste) ───────────────────────────────────

/** Escribe los 3 formatos en un `DataTransfer` (handler de `copy`/`cut`). */
export function writeBlocksToDataTransfer(dt: DataTransfer, blocks: readonly BlockData[]): void {
	dt.setData(ADC_BLOCKS_MIME, serializeBlocks(blocks));
	dt.setData("text/html", blocksToHtml(blocks));
	dt.setData("text/plain", blocksToPlainText(blocks));
}

/** Lee un `DataTransfer` priorizando `adc-blocks` → HTML → texto. */
export function readBlocksFromDataTransfer<B extends BlockData = BlockData>(dt: DataTransfer): ClipboardBlocksPayload<B> {
	const adc = dt.getData(ADC_BLOCKS_MIME);
	const html = dt.getData("text/html");
	const text = dt.getData("text/plain");
	const fromAdc = adc ? deserializeBlocks<B>(adc) : null;
	if (fromAdc && fromAdc.length > 0) return { blocks: fromAdc, text, html, source: "adc-blocks" };
	if (html.trim()) {
		const fromHtml = htmlToBlocks<B>(html);
		if (fromHtml.length > 0) return { blocks: fromHtml, text, html, source: "html" };
	}
	if (text.trim()) {
		const fromText = textToBlocks<B>(text);
		if (fromText.length > 0) return { blocks: fromText, text, html, source: "text" };
	}
	return { blocks: null, text, html, source: "none" };
}

// ── Async Clipboard API (botones explícitos) ────────────────────────────────

/** Copia bloques al portapapeles en los 3 formatos. Best-effort multi-navegador. */
export async function copyBlocksToClipboard(blocks: readonly BlockData[]): Promise<void> {
	const text = blocksToPlainText(blocks);
	const html = blocksToHtml(blocks);
	const json = serializeBlocks(blocks);
	try {
		const items: Record<string, Blob> = {
			"text/plain": new Blob([text], { type: "text/plain" }),
			"text/html": new Blob([html], { type: "text/html" }),
		};
		try {
			items[ADC_BLOCKS_WEB_MIME] = new Blob([json], { type: ADC_BLOCKS_MIME });
		} catch {
			// Formato custom no soportado: se omite, quedan text/html y text/plain.
		}
		await navigator.clipboard.write([new ClipboardItem(items)]);
	} catch {
		await navigator.clipboard.writeText(text);
	}
}

/** Lee bloques del portapapeles (async). Requiere permiso de lectura. */
export async function pasteBlocksFromClipboard<B extends BlockData = BlockData>(): Promise<ClipboardBlocksPayload<B>> {
	try {
		const items = await navigator.clipboard.read();
		let text = "";
		let html = "";
		let json = "";
		for (const item of items) {
			if (item.types.includes(ADC_BLOCKS_WEB_MIME)) json = await (await item.getType(ADC_BLOCKS_WEB_MIME)).text();
			if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
			if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
		}
		const fromAdc = json ? deserializeBlocks<B>(json) : null;
		if (fromAdc && fromAdc.length > 0) return { blocks: fromAdc, text, html, source: "adc-blocks" };
		if (html.trim()) {
			const fromHtml = htmlToBlocks<B>(html);
			if (fromHtml.length > 0) return { blocks: fromHtml, text, html, source: "html" };
		}
		if (text.trim()) return { blocks: textToBlocks<B>(text), text, html, source: "text" };
		return { blocks: null, text, html, source: "none" };
	} catch {
		const text = await navigator.clipboard.readText().catch(() => "");
		return { blocks: text ? textToBlocks<B>(text) : null, text, html: "", source: text ? "text" : "none" };
	}
}

// ── Registro de listeners ───────────────────────────────────────────────────

export interface RegisterBlocksClipboardOptions<B extends BlockData = BlockData> {
	/**
	 * Devuelve los bloques a copiar/cortar. Si retorna `null`/`undefined` o un
	 * array vacío, no se intercepta el evento (comportamiento nativo intacto).
	 */
	getBlocks?: (ev: ClipboardEvent) => B[] | null | undefined;
	/**
	 * Maneja el pegado con el payload ya resuelto en los 3 formatos. Retornar
	 * `true` cuando se consumió (se hace `preventDefault`); `false`/`undefined`
	 * deja el pegado nativo.
	 */
	onPaste?: (payload: ClipboardBlocksPayload<B>, ev: ClipboardEvent) => boolean | void;
	/** Tras copiar en un `cut` consumido, elimina la selección de origen. */
	onCut?: (ev: ClipboardEvent) => void;
	/** Habilita el listener de `copy` (default `true`). */
	handleCopy?: boolean;
	/** Habilita el listener de `cut` (default `false`). */
	handleCut?: boolean;
	/** Habilita el listener de `paste` (default `true`). */
	handlePaste?: boolean;
}

/**
 * Engancha listeners de portapapeles en `target` para soportar los 3 formatos
 * (`adc-blocks`, HTML y texto) tanto al copiar como al pegar. Devuelve una
 * función de limpieza que retira todos los listeners.
 */
export function registerBlocksClipboard<B extends BlockData = BlockData>(
	target: HTMLElement | Document,
	options: RegisterBlocksClipboardOptions<B>
): () => void {
	const { getBlocks, onPaste, onCut, handleCopy = true, handleCut = false, handlePaste = true } = options;

	const writeSelection = (ev: ClipboardEvent): boolean => {
		if (!getBlocks || !ev.clipboardData) return false;
		const blocks = getBlocks(ev);
		if (!blocks || blocks.length === 0) return false;
		ev.preventDefault();
		writeBlocksToDataTransfer(ev.clipboardData, blocks);
		return true;
	};

	const copyListener = (ev: ClipboardEvent) => {
		writeSelection(ev);
	};
	const cutListener = (ev: ClipboardEvent) => {
		if (writeSelection(ev)) onCut?.(ev);
	};
	const pasteListener = (ev: ClipboardEvent) => {
		if (!onPaste || !ev.clipboardData) return;
		const payload = readBlocksFromDataTransfer<B>(ev.clipboardData);
		onPaste(payload, ev);
	};

	if (handleCopy) target.addEventListener("copy", copyListener as EventListener);
	if (handleCut) target.addEventListener("cut", cutListener as EventListener);
	if (handlePaste) target.addEventListener("paste", pasteListener as EventListener);

	return () => {
		if (handleCopy) target.removeEventListener("copy", copyListener as EventListener);
		if (handleCut) target.removeEventListener("cut", cutListener as EventListener);
		if (handlePaste) target.removeEventListener("paste", pasteListener as EventListener);
	};
}

/** `true` si el target es un campo editable (input/textarea/contenteditable). */
export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName.toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") return true;
	return target.isContentEditable;
}
