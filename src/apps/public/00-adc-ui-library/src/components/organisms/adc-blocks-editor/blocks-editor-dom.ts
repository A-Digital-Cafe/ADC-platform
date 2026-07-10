import type { Block } from "../adc-blocks-renderer/adc-blocks-renderer";

/**
 * Helpers puros de DOM del `adc-blocks-editor`: conversión DOM→markdown inline,
 * transformaciones de bloques top-level del contenteditable y utilidades de
 * caret/selección. Sin estado del componente — reciben sus entradas por parámetro.
 */

const CHECKBOX_ROW_CLASS = "adc-blocks-editor__checkbox-row";

/** Acepta http(s) y rutas relativas; rechaza esquemas peligrosos y caracteres que rompan el atributo. */
export function sanitizeUrl(url: string): string | null {
	const value = url.trim();
	if (!value || /["'<>]/.test(value)) return null;
	if (value.startsWith("/") || value.startsWith("#")) return value;
	return /^https?:\/\//i.test(value) ? value : null;
}

/** Envuelve markdown inline según el tag (strong/em/code/a); div/p introducen salto de línea. */
function wrapInlineTag(tag: string, inner: string, el: HTMLElement): string {
	switch (tag) {
		case "strong":
		case "b":
			return inner ? `**${inner}**` : "";
		case "em":
		case "i":
			return inner ? `*${inner}*` : "";
		case "code":
			return inner ? `\`${inner}\`` : "";
		case "a": {
			const safe = sanitizeUrl(el.getAttribute("href") || "");
			return safe && inner ? `[${inner}](${safe})` : inner;
		}
		// Bloques: cada <div>/<p> introduce salto de línea.
		case "div":
		case "p":
			return `\n${inner}`;
		default:
			return inner;
	}
}

/** Recorre un nodo y emite markdown para texto + strong/em/code/a. Cualquier otro tag: extraer texto. */
export function nodeToMarkdown(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").replaceAll("\u200B", "");
	if (node.nodeType !== Node.ELEMENT_NODE) return "";
	const el = node as HTMLElement;
	const tag = el.tagName.toLowerCase();
	if (tag === "br") return "\n";
	return wrapInlineTag(tag, inlineMarkdown(el), el);
}

/** Recorre los hijos de un elemento generando markdown inline (sin tags de bloque). */
export function inlineMarkdown(el: Node): string {
	return Array.from(el.childNodes).map(nodeToMarkdown).join("");
}

/**
 * Convierte un elemento top-level del flujo a Block (checkbox-row, heading,
 * lista o párrafo), o `null` si queda vacío. Los cards standalone y los nodos
 * inline se resuelven antes, en `extractFlowBlocks`.
 */
export function flowElementToBlock(el: HTMLElement): Block | null {
	if (el.classList.contains(CHECKBOX_ROW_CLASS)) {
		const inputEl = el.querySelector(".adc-blocks-editor__checkbox-input") as HTMLInputElement | null;
		const spanEl = el.querySelector("span") || el;
		return { type: "checkbox", checked: inputEl ? inputEl.checked : false, text: inlineMarkdown(spanEl).trim() };
	}
	const tag = el.tagName.toLowerCase();
	if (tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
		const level = Number(tag.slice(1)) as 2 | 3 | 4 | 5 | 6;
		return { type: "heading", level, text: inlineMarkdown(el).trim() };
	}
	if (tag === "ul" || tag === "ol") {
		const items = Array.from(el.querySelectorAll(":scope > li")).map((li) => inlineMarkdown(li).trim());
		return { type: "list", ordered: tag === "ol", items };
	}
	const md = inlineMarkdown(el).trim();
	return md ? { type: "paragraph", text: md } : null;
}

// ── Transformaciones de bloques top-level (transformCurrentBlock) ────────────

/** innerHTML lógico de un bloque: si es checkbox-row, el contenido del <span>. */
function blockInnerHtml(block: HTMLElement): string {
	if (block.classList.contains(CHECKBOX_ROW_CLASS)) {
		const spanEl = block.querySelector("span");
		if (spanEl) return spanEl.innerHTML;
	}
	return block.innerHTML;
}

/** Crea una fila de checkbox editable con el contenido dado. */
function checkboxRowEl(innerHTML: string): HTMLElement {
	const newEl = document.createElement("div");
	newEl.className = `${CHECKBOX_ROW_CLASS} flex items-start gap-2 mb-2`;
	newEl.innerHTML = `<input type="checkbox" contenteditable="false" class="adc-blocks-editor__checkbox-input mt-1 cursor-pointer" /><span class="flex-1">${innerHTML || "<br>"}</span>`;
	return newEl;
}

function isListTag(block: HTMLElement): boolean {
	const tag = block.tagName.toLowerCase();
	return tag === "ul" || tag === "ol";
}

/** Fusiona los bloques target en un único UL/OL (un <li> por bloque; las listas previas mueven sus <li>). */
export function transformToList(targets: HTMLElement[], listTag: "ul" | "ol"): void {
	const list = document.createElement(listTag);
	for (const block of targets) {
		if (isListTag(block)) {
			for (const li of Array.from(block.querySelectorAll(":scope > li"))) {
				list.appendChild(li);
			}
		} else {
			const li = document.createElement("li");
			li.innerHTML = blockInnerHtml(block) || "<br>";
			list.appendChild(li);
		}
	}
	targets[0].replaceWith(list);
	for (const b of targets.slice(1)) b.remove();
}

/** Convierte cada bloque target en filas de checkbox (las listas: una fila por <li>). */
export function transformToCheckboxRows(targets: HTMLElement[]): void {
	for (const block of targets) {
		if (isListTag(block)) {
			const lis = Array.from(block.querySelectorAll(":scope > li"));
			block.replaceWith(...lis.map((li) => checkboxRowEl(li.innerHTML)));
		} else {
			block.replaceWith(checkboxRowEl(blockInnerHtml(block)));
		}
	}
}

/** Convierte cada bloque target a p/h2/h3/h4 (las listas: un bloque por <li>). */
export function transformToPlainBlocks(targets: HTMLElement[], target: "p" | "h2" | "h3" | "h4"): void {
	const tagName = target === "p" ? "div" : target;
	const plainEl = (innerHTML: string) => {
		const newEl = document.createElement(tagName);
		newEl.innerHTML = innerHTML || "<br>";
		return newEl;
	};
	for (const block of targets) {
		if (isListTag(block)) {
			const lis = Array.from(block.querySelectorAll(":scope > li"));
			block.replaceWith(...lis.map((li) => plainEl(li.innerHTML)));
		} else {
			block.replaceWith(plainEl(blockInnerHtml(block)));
		}
	}
}

// ── Caret / selección ────────────────────────────────────────────────────────

/** Ancestro top-level (hijo directo de `editorEl`) que contiene al nodo, si es un elemento. */
export function topLevelBlockOf(editorEl: HTMLElement, node: Node): HTMLElement | null {
	let current: Node | null = node;
	while (current && current.parentNode !== editorEl) current = current.parentNode;
	return current?.nodeType === Node.ELEMENT_NODE ? (current as HTMLElement) : null;
}

/** Marks activos (bold/italic/code) según los ancestros del inicio de la selección. */
export function marksAtSelection(editorEl: HTMLElement): { bold: boolean; italic: boolean; code: boolean } {
	const marks = { bold: false, italic: false, code: false };
	const sel = globalThis.getSelection();
	if (!sel || sel.rangeCount === 0) return marks;
	let node: Node | null = sel.getRangeAt(0).startContainer;
	while (node && node !== editorEl) {
		if (node.nodeType === Node.ELEMENT_NODE) {
			const tag = (node as HTMLElement).tagName.toLowerCase();
			if (tag === "code") marks.code = true;
			if (tag === "strong" || tag === "b") marks.bold = true;
			if (tag === "em" || tag === "i") marks.italic = true;
		}
		node = node.parentNode;
	}
	return marks;
}

/** Coloca el caret colapsado al final del contenido del nodo. */
export function placeCaretAtEnd(node: Node): void {
	const sel = globalThis.getSelection();
	if (!sel) return;
	const range = document.createRange();
	range.selectNodeContents(node);
	range.collapse(false);
	sel.removeAllRanges();
	sel.addRange(range);
}
