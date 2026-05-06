import { Component, Prop, h, Event, EventEmitter, State, Watch, Element } from "@stencil/core";
import type { Block } from "../adc-blocks-renderer/adc-blocks-renderer";

/**
 * Editor WYSIWYG inline para bloques de comentario. Usa `contenteditable` con
 * conversión bidireccional entre HTML del DOM y markdown inline (`**bold**`,
 * `*italic*`, `` `code` ``) que se persiste en `paragraph.text`.
 *
 * - Atajos: Ctrl/Cmd+B, Ctrl/Cmd+I, Ctrl/Cmd+E (code).
 * - Doble salto de línea genera un nuevo bloque `paragraph`.
 * - Los marks se aplican por selección (runs), nunca al paragraph completo.
 * - Soporta inserción/remoción de bloques `attachment`.
 */
@Component({
	tag: "adc-blocks-editor",
	styleUrl: "adc-blocks-editor.css",
	shadow: false,
})
export class AdcBlocksEditor {
	@Prop({ mutable: true }) blocks: Block[] = [];
	@Prop() placeholder: string = "Escribe un comentario...";
	@Prop() maxLength: number = 4000;
	@Prop() minHeight: number = 80;
	@Prop() disabled: boolean = false;
	/**
	 * Mapa opcional `attachmentId -> url` para previsualizar imágenes y enlazar
	 * archivos directamente desde el editor. Si está vacío, se muestran chips.
	 */
	@Prop() attachmentUrls: Record<string, string> = {};

	@State() activeMarks: { bold: boolean; italic: boolean; code: boolean } = { bold: false, italic: false, code: false };
	@State() charCount: number = 0;
	@State() blockMenuOpen: boolean = false;
	@State() headingMenuOpen: boolean = false;
	@State() listMenuOpen: boolean = false;

	@Element() host!: HTMLElement;

	@Event() adcBlocksChange!: EventEmitter<Block[]>;
	/** Pide al consumidor que abra un selector de archivo y haga el upload. */
	@Event() adcRequestAttachment!: EventEmitter<{ kind: "image" | "file" }>;

	private editorEl: HTMLDivElement | null = null;
	/** Indica que el cambio de `blocks` viene de nuestra propia emisión y no se debe re-sincronizar el DOM. */
	private suppressSync: boolean = false;
	/** Mapa estable id → bloque standalone para preservar orden entre DOM e input. */
	private standaloneById: Map<string, Block> = new Map();
	private nextStandaloneId: number = 1;

	componentDidLoad() {
		this.syncDomFromBlocks();
	}

	@Watch("blocks")
	onBlocksProp() {
		if (this.suppressSync) {
			this.suppressSync = false;
			return;
		}
		this.syncDomFromBlocks();
	}

	/**
	 * Cuando llegan URLs de adjuntos (resueltas async tras el upload o al cargar
	 * un comentario existente), refrescamos in-place sólo el contenido de las
	 * cards de tipo "attachment" para no destruir la selección/caret del editor.
	 */
	@Watch("attachmentUrls")
	onAttachmentUrlsChange() {
		if (!this.editorEl) return;
		for (const [id, block] of this.standaloneById) {
			if (block.type !== "attachment") continue;
			const cardEl = this.editorEl.querySelector(`[data-standalone-id="${id}"]`);
			if (!cardEl) continue;
			const oldContent = cardEl.querySelector(".adc-blocks-editor__standalone-attachment");
			if (!oldContent) continue;
			const tmp = document.createElement("div");
			tmp.innerHTML = this.attachmentCardContent(block);
			const newContent = tmp.firstElementChild;
			if (newContent) oldContent.replaceWith(newContent);
		}
	}

	// ── Markdown ↔ HTML ──────────────────────────────────────────────────────

	private static escapeHtml(s: string): string {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	/** Convierte markdown inline a HTML seguro. Tokens soportados: **bold**, *italic*, `code`. */
	private static markdownToHtml(md: string): string {
		const escaped = AdcBlocksEditor.escapeHtml(md);
		// Orden: bold antes que italic para evitar que `*` capture `**`.
		return escaped
			.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
			.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
			.replace(/`([^`\n]+?)`/g, "<code>$1</code>");
	}

	/** Recorre un nodo y emite markdown para texto + strong/em/code. Cualquier otro tag: extraer texto. */
	private static nodeToMarkdown(node: Node): string {
		if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").replace(/\u200B/g, "");
		if (node.nodeType !== Node.ELEMENT_NODE) return "";
		const el = node as HTMLElement;
		const tag = el.tagName.toLowerCase();
		if (tag === "br") return "\n";
		const inner = Array.from(el.childNodes).map(AdcBlocksEditor.nodeToMarkdown).join("");
		if (tag === "strong" || tag === "b") return inner ? `**${inner}**` : "";
		if (tag === "em" || tag === "i") return inner ? `*${inner}*` : "";
		if (tag === "code") return inner ? `\`${inner}\`` : "";
		// Bloques: cada <div>/<p> introduce salto de línea.
		if (tag === "div" || tag === "p") return `\n${inner}`;
		return inner;
	}

	/** Determina si el bloque es un "card" no editable embebido en el flujo (code/quote/callout/divider/table/attachment). */
	private static isStandaloneCardBlock(b: Block): boolean {
		return (
			b.type === "code" ||
			b.type === "quote" ||
			b.type === "callout" ||
			b.type === "divider" ||
			b.type === "table" ||
			b.type === "attachment"
		);
	}

	/** Controles del header (input de lenguaje, select de tono) según el tipo. */
	private static standaloneHeaderControls(b: Block): string {
		if (b.type === "code") {
			const lang = AdcBlocksEditor.escapeHtml(b.language || "");
			return `<input type="text" class="adc-blocks-editor__standalone-input" data-standalone-action="language" placeholder="lenguaje" value="${lang}" />`;
		}
		if (b.type === "callout") {
			const tones = ["info", "warning", "success", "error"] as const;
			const opts = tones.map((t) => `<option value="${t}"${b.tone === t ? " selected" : ""}>${t}</option>`).join("");
			return `<select class="adc-blocks-editor__standalone-input" data-standalone-action="tone">${opts}</select>`;
		}
		return "";
	}

	/** Cuerpo editable del bloque standalone (contenteditable=true en un área anidada). */
	private standaloneEditableContent(b: Block): string {
		switch (b.type) {
			case "code":
				return `<pre class="adc-blocks-editor__standalone-content adc-blocks-editor__standalone-code" data-standalone-content contenteditable="true" spellcheck="false">${AdcBlocksEditor.escapeHtml(b.content || "")}</pre>`;
			case "quote":
				return `<blockquote class="adc-blocks-editor__standalone-content adc-blocks-editor__standalone-quote" data-standalone-content contenteditable="true" data-placeholder="Cita">${AdcBlocksEditor.escapeHtml(b.text || "") || "<br>"}</blockquote>`;
			case "callout":
				return `<div class="adc-blocks-editor__standalone-content adc-blocks-editor__standalone-callout" data-standalone-content contenteditable="true" data-placeholder="Mensaje destacado">${AdcBlocksEditor.escapeHtml(b.text || "") || "<br>"}</div>`;
			case "divider":
				return `<hr class="adc-blocks-editor__standalone-divider" />`;
			case "table":
				return `<div class="adc-blocks-editor__standalone-content"><em>Tabla (${b.rows?.length || 0} filas)</em></div>`;
			case "attachment":
				return this.attachmentCardContent(b);
			default:
				return "";
		}
	}

	/** Renderiza el contenido de la card de un adjunto: preview de imagen o chip de archivo. */
	private attachmentCardContent(b: Block): string {
		const url = b.attachmentId ? this.attachmentUrls[b.attachmentId] : undefined;
		const safeName = AdcBlocksEditor.escapeHtml(b.fileName || "");
		const sizeStr = AdcBlocksEditor.formatBytes(b.size);
		const sizeHtml = sizeStr
			? `<span class="adc-blocks-editor__standalone-attachment-size">${AdcBlocksEditor.escapeHtml(sizeStr)}</span>`
			: "";
		if (b.kind === "image") {
			const preview = url
				? `<img src="${AdcBlocksEditor.escapeHtml(url)}" alt="${AdcBlocksEditor.escapeHtml(b.alt || b.fileName || "")}" class="adc-blocks-editor__standalone-attachment-img" loading="lazy" />`
				: `<div class="adc-blocks-editor__standalone-attachment-placeholder" aria-hidden="true">🖼️</div>`;
			return `<figure class="adc-blocks-editor__standalone-content adc-blocks-editor__standalone-attachment" data-attachment-kind="image">${preview}<figcaption class="adc-blocks-editor__standalone-attachment-caption">${safeName}${sizeHtml}</figcaption></figure>`;
		}
		return `<div class="adc-blocks-editor__standalone-content adc-blocks-editor__standalone-attachment" data-attachment-kind="file"><span class="adc-blocks-editor__standalone-attachment-icon" aria-hidden="true">📎</span><span class="adc-blocks-editor__standalone-attachment-name">${safeName}</span>${sizeHtml}</div>`;
	}

	/** Lee el estado actual de un bloque standalone desde su DOM (contenido, lenguaje, tono). */
	private static readStandaloneFromDom(current: Block, cardEl: HTMLElement): Block {
		const contentEl = cardEl.querySelector("[data-standalone-content]") as HTMLElement | null;
		if (current.type === "code") {
			const langInput = cardEl.querySelector('[data-standalone-action="language"]') as HTMLInputElement | null;
			return {
				...current,
				language: (langInput?.value ?? current.language) || "text",
				content: contentEl?.innerText ?? "",
			};
		}
		if (current.type === "quote") {
			return { ...current, text: (contentEl?.innerText ?? "").trim() };
		}
		if (current.type === "callout") {
			const toneSel = cardEl.querySelector('[data-standalone-action="tone"]') as HTMLSelectElement | null;
			const tone = (toneSel?.value || current.tone || "info") as "info" | "warning" | "success" | "error";
			return { ...current, tone, text: (contentEl?.innerText ?? "").trim() };
		}
		return current;
	}

	private static standaloneLabel(b: Block): string {
		switch (b.type) {
			case "code":
				return `Código${b.language ? ` · ${b.language}` : ""}`;
			case "quote":
				return "Cita";
			case "callout":
				return `Destacado${b.tone ? ` · ${b.tone}` : ""}`;
			case "table":
				return "Tabla";
			case "divider":
				return "Divisor";
			case "attachment":
				return b.kind === "image" ? "Imagen" : "Archivo";
			default:
				return "Bloque";
		}
	}

	/** Recorre el contenteditable y reconstruye la lista de bloques inline + standalone en su orden real. */
	private extractFlowBlocks(): Block[] {
		if (!this.editorEl) return [];
		const blocks: Block[] = [];
		const orderedStandalone: Array<[string, Block]> = [];
		for (const child of Array.from(this.editorEl.childNodes)) {
			if (child.nodeType !== Node.ELEMENT_NODE) {
				const text = (child.textContent ?? "").trim();
				if (text) blocks.push({ type: "paragraph", text });
				continue;
			}
			const el = child as HTMLElement;
			const id = el.dataset?.standaloneId;
			if (id && this.standaloneById.has(id)) {
				const current = this.standaloneById.get(id)!;
				const updated = AdcBlocksEditor.readStandaloneFromDom(current, el);
				this.standaloneById.set(id, updated);
				orderedStandalone.push([id, updated]);
				blocks.push(updated);
				continue;
			}
			const tag = el.tagName.toLowerCase();
			if (tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
				const text = AdcBlocksEditor.inlineMarkdown(el).trim();
				const level = Number(tag.slice(1)) as 2 | 3 | 4 | 5 | 6;
				blocks.push({ type: "heading", level, text });
				continue;
			}
			if (tag === "ul" || tag === "ol") {
				const items = Array.from(el.querySelectorAll(":scope > li")).map((li) => AdcBlocksEditor.inlineMarkdown(li).trim());
				blocks.push({ type: "list", ordered: tag === "ol", items });
				continue;
			}
			const md = AdcBlocksEditor.inlineMarkdown(el).trim();
			if (md) blocks.push({ type: "paragraph", text: md });
		}
		// Reordenar el Map según el orden encontrado en DOM, descartando ids huérfanos.
		this.standaloneById = new Map(orderedStandalone);
		return blocks;
	}

	/** Recorre los hijos de un elemento generando markdown inline (sin tags de bloque). */
	private static inlineMarkdown(el: Node): string {
		return Array.from(el.childNodes).map(AdcBlocksEditor.nodeToMarkdown).join("");
	}

	/** Convierte tamaño en bytes a representación humana ("12.3 KB"). */
	private static formatBytes(bytes?: number): string {
		if (!bytes || bytes <= 0) return "";
		const units = ["B", "KB", "MB", "GB"];
		let n = bytes;
		let i = 0;
		while (n >= 1024 && i < units.length - 1) {
			n /= 1024;
			i++;
		}
		return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
	}

	private buildBlocks(): Block[] {
		// Todos los bloques (incluidos attachments) viven dentro del flujo del editor.
		return this.extractFlowBlocks();
	}

	private syncDomFromBlocks() {
		if (!this.editorEl) return;
		const flowBlocks = this.blocks || [];
		// Reconstruir el mapa standalone preservando ids previos cuando sea posible.
		const previous = new Map(this.standaloneById);
		this.standaloneById = new Map();
		// Reasignar ids en el orden de aparición; reciclar ids cuyo bloque coincida por referencia.
		const idLookup = new Map<Block, string>();
		for (const [oldId, oldBlock] of previous) idLookup.set(oldBlock, oldId);
		const used = new Set<string>();
		for (const b of flowBlocks) {
			if (!AdcBlocksEditor.isStandaloneCardBlock(b)) continue;
			const reused = idLookup.get(b);
			const id = reused && !used.has(reused) ? reused : `sa-${this.nextStandaloneId++}`;
			used.add(id);
			this.standaloneById.set(id, b);
		}

		if (flowBlocks.length === 0) {
			this.editorEl.innerHTML = "";
			this.charCount = 0;
			return;
		}
		const html = flowBlocks
			.map((b) => {
				if (b.type === "heading") {
					const inner = AdcBlocksEditor.markdownToHtml(b.text || "") || "<br>";
					return `<h${b.level}>${inner}</h${b.level}>`;
				}
				if (b.type === "list") {
					const tag = b.ordered ? "ol" : "ul";
					const lis = (b.items || []).map((it) => `<li>${AdcBlocksEditor.markdownToHtml(it || "") || "<br>"}</li>`).join("");
					return `<${tag}>${lis || "<li><br></li>"}</${tag}>`;
				}
				if (b.type === "paragraph") {
					const inner = AdcBlocksEditor.markdownToHtml(b.text || "") || "<br>";
					return `<div>${inner}</div>`;
				}
				if (AdcBlocksEditor.isStandaloneCardBlock(b)) {
					// Buscar id ya asignado.
					let id = "";
					for (const [k, v] of this.standaloneById)
						if (v === b) {
							id = k;
							break;
						}
					return this.standaloneCardHtml(id, b);
				}
				return "";
			})
			.join("");
		this.editorEl.innerHTML = html;
		// Asegurar que siempre haya un párrafo vacío al final para escribir.
		this.ensureTrailingParagraph();
		this.charCount = (this.editorEl.textContent || "").length;
	}

	/** Si el último hijo del editor es un standalone, añade un párrafo vacío para poder seguir escribiendo. */
	private ensureTrailingParagraph() {
		if (!this.editorEl) return;
		const last = this.editorEl.lastElementChild as HTMLElement | null;
		if (!last || last.dataset?.standaloneId) {
			const p = document.createElement("div");
			p.innerHTML = "<br>";
			this.editorEl.appendChild(p);
		}
	}

	/** HTML de una card con cuerpo editable que representa un bloque standalone en el flujo. */
	private standaloneCardHtml(id: string, b: Block): string {
		const label = AdcBlocksEditor.standaloneLabel(b);
		const controls = AdcBlocksEditor.standaloneHeaderControls(b);
		const content = this.standaloneEditableContent(b);
		return (
			`<div class="adc-blocks-editor__standalone" contenteditable="false" data-standalone-id="${id}" role="group" aria-label="${AdcBlocksEditor.escapeHtml(label)}">` +
			`<div class="adc-blocks-editor__standalone-header">` +
			`<span class="adc-blocks-editor__standalone-label">${AdcBlocksEditor.escapeHtml(label)}</span>` +
			`<span class="adc-blocks-editor__standalone-controls">${controls}</span>` +
			`<button type="button" class="adc-blocks-editor__standalone-remove" data-standalone-action="remove" aria-label="Quitar bloque">✕</button>` +
			`</div>` +
			content +
			`</div>`
		);
	}

	private emit() {
		const next = this.buildBlocks();
		const totalChars = next.filter((b) => b.type === "paragraph").reduce((acc, b) => acc + (b.text?.length ?? 0), 0);
		if (totalChars > this.maxLength) {
			this.syncDomFromBlocks();
			return;
		}
		this.charCount = (this.editorEl?.textContent || "").length;
		this.suppressSync = true;
		this.blocks = next;
		this.adcBlocksChange.emit(next);
	}

	// ── Selección y comandos ────────────────────────────────────────────────

	private isSelectionInsideEditor(): boolean {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return false;
		const range = sel.getRangeAt(0);
		return !!this.editorEl && this.editorEl.contains(range.commonAncestorContainer);
	}

	private updateActiveMarks() {
		if (!this.isSelectionInsideEditor()) {
			this.activeMarks = { bold: false, italic: false, code: false };
			return;
		}
		const sel = window.getSelection();
		let isCode = false;
		if (sel && sel.rangeCount > 0) {
			let node: Node | null = sel.getRangeAt(0).startContainer;
			while (node && node !== this.editorEl) {
				if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName.toLowerCase() === "code") {
					isCode = true;
					break;
				}
				node = node.parentNode;
			}
		}
		this.activeMarks = {
			bold: document.queryCommandState("bold"),
			italic: document.queryCommandState("italic"),
			code: isCode,
		};
	}

	private execMark(mark: "bold" | "italic" | "code") {
		if (!this.editorEl) return;
		this.editorEl.focus();
		if (mark === "code") {
			this.toggleCodeOnSelection();
		} else {
			document.execCommand(mark, false);
		}
		this.updateActiveMarks();
		this.emit();
	}

	private toggleCodeOnSelection() {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		const startParent =
			range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
				? (range.commonAncestorContainer as HTMLElement)
				: range.commonAncestorContainer.parentElement;
		const codeAncestor = startParent?.closest("code");

		// Selección colapsada: toggle "modo code" con un <code> vacío y ZWSP
		// (zero-width space) para fijar el caret dentro/fuera del span.
		if (sel.isCollapsed) {
			if (codeAncestor && this.editorEl?.contains(codeAncestor)) {
				// Salir del code: mover el caret justo después del elemento.
				const after = document.createRange();
				after.setStartAfter(codeAncestor);
				after.collapse(true);
				sel.removeAllRanges();
				sel.addRange(after);
				return;
			}
			const code = document.createElement("code");
			// ZWSP para que el caret sea posicionable dentro del code vacío.
			code.appendChild(document.createTextNode("\u200B"));
			range.insertNode(code);
			const inside = document.createRange();
			inside.setStart(code.firstChild!, 1);
			inside.collapse(true);
			sel.removeAllRanges();
			sel.addRange(inside);
			return;
		}

		if (codeAncestor && this.editorEl?.contains(codeAncestor)) {
			const text = codeAncestor.textContent || "";
			codeAncestor.replaceWith(document.createTextNode(text));
			return;
		}
		const text = range.toString();
		if (!text) return;
		const code = document.createElement("code");
		code.textContent = text;
		range.deleteContents();
		range.insertNode(code);
		range.setStartAfter(code);
		range.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range);
	}

	private readonly handleInput = () => {
		// Detectar atajos markdown justo después de espacio (e.g. "* ", "1. ", "# ").
		this.maybeApplyMarkdownShortcut();
		this.updateActiveMarks();
		this.emit();
	};

	private readonly handleKeyDown = (ev: KeyboardEvent) => {
		const mod = ev.ctrlKey || ev.metaKey;
		if (!mod) return;
		const key = ev.key.toLowerCase();
		if (key === "b") {
			ev.preventDefault();
			this.execMark("bold");
		} else if (key === "i") {
			ev.preventDefault();
			this.execMark("italic");
		} else if (key === "e") {
			ev.preventDefault();
			this.execMark("code");
		}
	};

	private readonly handleSelectionChange = () => {
		this.updateActiveMarks();
	};

	/**
	 * Transforma el bloque que contiene el caret/selección actual a otro tipo
	 * inline: párrafo (`p`), heading (`h2`/`h3`/`h4`) o lista (`ul`/`ol`).
	 * Si la selección abarca múltiples bloques, los transforma todos.
	 */
	private transformCurrentBlock(target: "p" | "h2" | "h3" | "h4" | "ul" | "ol") {
		if (!this.editorEl) return;
		this.editorEl.focus();
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		// Asegurar que la selección está dentro del editor.
		if (!this.editorEl.contains(range.commonAncestorContainer)) return;

		const findTopBlock = (node: Node): HTMLElement | null => {
			let current: Node | null = node;
			while (current && current.parentNode !== this.editorEl) current = current.parentNode;
			return current && current.nodeType === Node.ELEMENT_NODE ? (current as HTMLElement) : null;
		};

		const startBlock = findTopBlock(range.startContainer);
		const endBlock = findTopBlock(range.endContainer);
		if (!startBlock || !endBlock) return;

		// Recolectar bloques entre start y end (inclusivo) en orden DOM.
		const all = Array.from(this.editorEl.children) as HTMLElement[];
		const startIdx = all.indexOf(startBlock);
		const endIdx = all.indexOf(endBlock);
		if (startIdx === -1 || endIdx === -1) return;
		const targets = all.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);

		if (target === "ul" || target === "ol") {
			// Crear UL/OL único con un <li> por cada bloque target.
			const list = document.createElement(target);
			for (const block of targets) {
				const li = document.createElement("li");
				// Si era lista previa, mover sus <li> en vez de envolver.
				if (block.tagName.toLowerCase() === "ul" || block.tagName.toLowerCase() === "ol") {
					for (const li2 of Array.from(block.querySelectorAll(":scope > li"))) {
						list.appendChild(li2);
					}
				} else {
					li.innerHTML = block.innerHTML || "<br>";
					list.appendChild(li);
				}
			}
			targets[0].replaceWith(list);
			for (const b of targets.slice(1)) b.remove();
		} else {
			// p / h2 / h3 / h4
			for (const block of targets) {
				const tag = block.tagName.toLowerCase();
				if (tag === "ul" || tag === "ol") {
					// Convertir cada <li> en un bloque target separado.
					const lis = Array.from(block.querySelectorAll(":scope > li"));
					const replacements: HTMLElement[] = lis.map((li) => {
						const newEl = document.createElement(target === "p" ? "div" : target);
						newEl.innerHTML = li.innerHTML || "<br>";
						return newEl;
					});
					block.replaceWith(...replacements);
				} else {
					const newEl = document.createElement(target === "p" ? "div" : target);
					newEl.innerHTML = block.innerHTML || "<br>";
					block.replaceWith(newEl);
				}
			}
		}
		this.emit();
		// Restaurar caret al primer hijo nuevo
		const first = this.editorEl.children[Math.min(startIdx, endIdx)] as HTMLElement | undefined;
		if (first) {
			const newRange = document.createRange();
			newRange.selectNodeContents(first);
			newRange.collapse(false);
			sel.removeAllRanges();
			sel.addRange(newRange);
		}
	}

	/**
	 * Detecta atajos markdown al inicio de un bloque y lo convierte:
	 *   `* `  → lista desordenada
	 *   `1. ` → lista ordenada
	 *   `# `  → heading h2 ;  `## ` → h3 ; `### ` → h4
	 */
	private maybeApplyMarkdownShortcut(): boolean {
		if (!this.editorEl) return false;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
		const range = sel.getRangeAt(0);
		if (!this.editorEl.contains(range.startContainer)) return false;
		// Identificar el bloque actual (top-level child).
		let block: Node | null = range.startContainer;
		while (block && block.parentNode !== this.editorEl) block = block.parentNode;
		if (!block || block.nodeType !== Node.ELEMENT_NODE) return false;
		const blockEl = block as HTMLElement;
		const tag = blockEl.tagName.toLowerCase();
		// No aplicar si ya es lista o heading.
		if (tag === "ul" || tag === "ol" || tag.startsWith("h")) return false;
		const text = blockEl.textContent ?? "";
		let target: "ul" | "ol" | "h2" | "h3" | "h4" | null = null;
		let stripLen = 0;
		const ulMatch = /^(\*|-) $/.exec(text);
		const olMatch = /^(\d+)\. $/.exec(text);
		const hMatch = /^(#{1,3}) $/.exec(text);
		if (ulMatch) {
			target = "ul";
			stripLen = ulMatch[0].length;
		} else if (olMatch) {
			target = "ol";
			stripLen = olMatch[0].length;
		} else if (hMatch) {
			const lvl = hMatch[1].length;
			target = `h${lvl + 1}` as "h2" | "h3" | "h4";
			stripLen = hMatch[0].length;
		}
		if (!target) return false;
		// Quitar el prefijo del bloque y transformar.
		blockEl.textContent = text.slice(stripLen);
		this.transformCurrentBlock(target);
		// Mover caret al final del nuevo bloque
		const newBlock = this.editorEl.children[Array.from(this.editorEl.children).indexOf(blockEl)] || blockEl;
		const r = document.createRange();
		r.selectNodeContents(newBlock);
		r.collapse(false);
		sel.removeAllRanges();
		sel.addRange(r);
		return true;
	}

	private readonly handleEditorClick = (ev: MouseEvent) => {
		const target = ev.target as HTMLElement | null;
		if (!target) return;
		const removeBtn = target.closest('[data-standalone-action="remove"]') as HTMLElement | null;
		if (!removeBtn) return;
		const card = removeBtn.closest("[data-standalone-id]") as HTMLElement | null;
		const id = card?.dataset?.standaloneId;
		if (id) {
			ev.preventDefault();
			this.removeStandaloneById(id);
		}
	};

	private readonly handlePaste = (ev: ClipboardEvent) => {
		// Forzar pegado como texto plano para no contaminar con HTML externo.
		ev.preventDefault();
		const text = ev.clipboardData?.getData("text/plain") ?? "";
		if (!text) return;
		document.execCommand("insertText", false, text);
	};

	// ── Bloques estructurales (code/quote/callout/divider) ─────────────────

	/**
	 * Inserta un bloque standalone como card en la posición actual del caret
	 * dentro del contenteditable, garantizando un párrafo vacío posterior para
	 * continuar escribiendo. Si la selección está fuera del editor, lo añade al
	 * final.
	 */
	private insertStructuralBlock(kind: "code" | "quote" | "callout" | "divider") {
		const newBlock: Block | null = (() => {
			switch (kind) {
				case "code":
					return { type: "code", language: "text", content: "" } as Block;
				case "quote":
					return { type: "quote", text: "" } as Block;
				case "callout":
					return { type: "callout", tone: "info", text: "" } as Block;
				case "divider":
					return { type: "divider" } as Block;
				default:
					return null;
			}
		})();
		if (!newBlock || !this.editorEl) return;
		const id = `sa-${this.nextStandaloneId++}`;
		this.standaloneById.set(id, newBlock);
		// Construir la card y un párrafo vacío trailing.
		const wrapper = document.createElement("div");
		wrapper.innerHTML = this.standaloneCardHtml(id, newBlock);
		const cardEl = wrapper.firstElementChild as HTMLElement;
		const trailing = document.createElement("div");
		trailing.innerHTML = "<br>";
		// Localizar el bloque hijo top-level que contiene el caret.
		const sel = window.getSelection();
		let anchor: HTMLElement | null = null;
		if (sel && sel.rangeCount > 0 && this.editorEl.contains(sel.getRangeAt(0).startContainer)) {
			let n: Node | null = sel.getRangeAt(0).startContainer;
			while (n && n.parentNode !== this.editorEl) n = n.parentNode;
			anchor = n && n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement) : null;
		}
		if (anchor && anchor.parentNode === this.editorEl) {
			anchor.after(cardEl);
			cardEl.after(trailing);
		} else {
			this.editorEl.appendChild(cardEl);
			this.editorEl.appendChild(trailing);
		}
		// Mover el caret al párrafo trailing.
		const range = document.createRange();
		range.selectNodeContents(trailing);
		range.collapse(true);
		sel?.removeAllRanges();
		sel?.addRange(range);
		this.blockMenuOpen = false;
		this.emit();
	}

	private removeStandaloneById(id: string) {
		if (!this.editorEl) return;
		const card = this.editorEl.querySelector(`[data-standalone-id="${id}"]`);
		if (card) card.remove();
		this.standaloneById.delete(id);
		// Garantizar al menos un bloque inline visible.
		if (this.editorEl.children.length === 0) {
			const p = document.createElement("div");
			p.innerHTML = "<br>";
			this.editorEl.appendChild(p);
		}
		this.emit();
	}

	private readonly handleEditorChange = (ev: Event) => {
		const t = ev.target as HTMLElement | null;
		if (!t) return;
		const action = t.getAttribute("data-standalone-action");
		if (action === "language" || action === "tone") {
			this.emit();
		}
	};

	private renderToolButton(opts: {
		label: string;
		shortcut?: string;
		active?: boolean;
		onClick: () => void;
		children: any;
		disabled?: boolean;
	}) {
		const base =
			"inline-flex items-center justify-center w-8 h-8 rounded-md text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer";
		const state = opts.active
			? "bg-primary text-onPrimary shadow-sm hover:bg-primary"
			: "bg-transparent text-text hover:bg-alt hover:text-text active:bg-alt/70";
		const title = opts.shortcut ? `${opts.label} (${opts.shortcut})` : opts.label;
		return (
			<button
				type="button"
				class={`${base} ${state}`}
				// `mousedown` con preventDefault preserva la selección activa del editor.
				onMouseDown={(ev) => ev.preventDefault()}
				onClick={opts.onClick}
				disabled={opts.disabled || this.disabled}
				aria-pressed={opts.active ? "true" : "false"}
				aria-label={opts.label}
				title={title}
			>
				{opts.children}
			</button>
		);
	}

	render() {
		const remaining = this.maxLength - this.charCount;
		const lowOnChars = remaining <= Math.max(20, Math.floor(this.maxLength * 0.05));
		// Sólo bloques realmente "standalone" — heading/list son inline (toolbar dedicado).
		const blockKinds: Array<{ key: "code" | "quote" | "callout" | "divider"; label: string; icon: string }> = [
			{ key: "code", label: "Código", icon: "{}" },
			{ key: "quote", label: "Cita", icon: "❝" },
			{ key: "callout", label: "Destacado", icon: "!" },
			{ key: "divider", label: "Divisor", icon: "—" },
		];
		const headingLevels: Array<{ level: 2 | 3 | 4; label: string }> = [
			{ level: 2, label: "H1" },
			{ level: 3, label: "H2" },
			{ level: 4, label: "H3" },
		];
		return (
			<div class="flex flex-col gap-0 bg-surface rounded-xxl border border-alt">
				<div class="flex flex-wrap gap-1 items-center px-2 pt-2 pb-2 border-b border-alt bg-surface relative">
					<div class="inline-flex items-center gap-0.5" role="group" aria-label="Formato">
						{this.renderToolButton({
							label: "Negrita",
							shortcut: "Ctrl+B",
							active: this.activeMarks.bold,
							onClick: () => this.execMark("bold"),
							children: <span class="font-bold">B</span>,
						})}
						{this.renderToolButton({
							label: "Cursiva",
							shortcut: "Ctrl+I",
							active: this.activeMarks.italic,
							onClick: () => this.execMark("italic"),
							children: <span class="italic font-serif">I</span>,
						})}
						{this.renderToolButton({
							label: "Código",
							shortcut: "Ctrl+E",
							active: this.activeMarks.code,
							onClick: () => this.execMark("code"),
							children: <span class="font-mono text-xs">{"</>"}</span>,
						})}
					</div>

					<span class="w-px h-5 bg-alt mx-1" aria-hidden="true" />

					<div class="inline-flex items-center gap-0.5" role="group" aria-label="Estructura de línea">
						{this.renderToolButton({
							label: "Párrafo",
							onClick: () => this.transformCurrentBlock("p"),
							children: <span class="font-semibold text-xs">P</span>,
						})}
						<div class="relative inline-flex">
							{this.renderToolButton({
								label: "Título",
								active: this.headingMenuOpen,
								onClick: () => {
									this.headingMenuOpen = !this.headingMenuOpen;
									this.listMenuOpen = false;
									this.blockMenuOpen = false;
								},
								children: <span class="font-bold text-xs">H</span>,
							})}
							{this.headingMenuOpen && (
								<div
									class="absolute top-full left-0 mt-1 z-50 flex flex-col bg-surface border border-alt rounded-md shadow-cozy min-w-32"
									role="menu"
									aria-label="Niveles de título"
								>
									{headingLevels.map((hl) => (
										<button
											key={`h${hl.level}`}
											type="button"
											class="flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-alt text-left cursor-pointer"
											onMouseDown={(ev) => ev.preventDefault()}
											onClick={() => {
												this.transformCurrentBlock(`h${hl.level}` as "h2" | "h3" | "h4");
												this.headingMenuOpen = false;
											}}
											role="menuitem"
										>
											<span class="font-bold w-6">{hl.label}</span>
										</button>
									))}
								</div>
							)}
						</div>
						<div class="relative inline-flex">
							{this.renderToolButton({
								label: "Lista",
								active: this.listMenuOpen,
								onClick: () => {
									this.listMenuOpen = !this.listMenuOpen;
									this.headingMenuOpen = false;
									this.blockMenuOpen = false;
								},
								children: <span aria-hidden="true">•</span>,
							})}
							{this.listMenuOpen && (
								<div
									class="absolute top-full left-0 mt-1 z-50 flex flex-col bg-surface border border-alt rounded-md shadow-cozy min-w-44"
									role="menu"
									aria-label="Tipos de lista"
								>
									<button
										type="button"
										class="flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-alt text-left cursor-pointer"
										onMouseDown={(ev) => ev.preventDefault()}
										onClick={() => {
											this.transformCurrentBlock("ul");
											this.listMenuOpen = false;
										}}
										role="menuitem"
									>
										<span class="w-5 text-center">•</span>
										<span>Desordenada</span>
									</button>
									<button
										type="button"
										class="flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-alt text-left cursor-pointer"
										onMouseDown={(ev) => ev.preventDefault()}
										onClick={() => {
											this.transformCurrentBlock("ol");
											this.listMenuOpen = false;
										}}
										role="menuitem"
									>
										<span class="w-5 text-center font-mono text-xs">1.</span>
										<span>Ordenada</span>
									</button>
								</div>
							)}
						</div>
					</div>

					<span class="w-px h-5 bg-alt mx-1" aria-hidden="true" />

					<div class="inline-flex items-center gap-0.5 relative" role="group" aria-label="Insertar bloque">
						{this.renderToolButton({
							label: "Insertar bloque",
							active: this.blockMenuOpen,
							onClick: () => {
								this.blockMenuOpen = !this.blockMenuOpen;
								this.headingMenuOpen = false;
								this.listMenuOpen = false;
							},
							children: <span class="font-bold">+</span>,
						})}
						{this.blockMenuOpen && (
							<div
								class="absolute top-full left-0 mt-1 z-50 flex flex-col bg-surface border border-alt rounded-md shadow-cozy min-w-40"
								role="menu"
								aria-label="Insertar bloque"
							>
								{blockKinds.map((bk) => (
									<button
										key={bk.key}
										type="button"
										class="flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-alt text-left cursor-pointer"
										onMouseDown={(ev) => ev.preventDefault()}
										onClick={() => {
											this.insertStructuralBlock(bk.key);
											this.blockMenuOpen = false;
										}}
										role="menuitem"
									>
										<span class="font-mono text-xs w-4 text-center">{bk.icon}</span>
										<span>{bk.label}</span>
									</button>
								))}
							</div>
						)}
					</div>

					<span class="w-px h-5 bg-alt mx-1" aria-hidden="true" />

					<div class="inline-flex items-center gap-0.5" role="group" aria-label="Adjuntos">
						{this.renderToolButton({
							label: "Adjuntar imagen",
							onClick: () => this.adcRequestAttachment.emit({ kind: "image" }),
							children: <span aria-hidden="true">🖼️</span>,
						})}
						{this.renderToolButton({
							label: "Adjuntar archivo",
							onClick: () => this.adcRequestAttachment.emit({ kind: "file" }),
							children: <span aria-hidden="true">📎</span>,
						})}
					</div>

					<span class="ml-auto inline-flex items-center gap-2 pr-1">
						<small class={`text-xs tabular-nums ${lowOnChars ? "text-tdanger" : "text-muted"}`}>{remaining}</small>
					</span>
				</div>

				<div
					ref={(el) => (this.editorEl = el ?? null)}
					contentEditable={!this.disabled}
					data-placeholder={this.placeholder}
					role="textbox"
					aria-label={this.placeholder}
					aria-multiline="true"
					aria-disabled={this.disabled ? "true" : "false"}
					style={{ minHeight: `${this.minHeight}px` }}
					class="adc-blocks-editor__input w-full px-3 py-2 bg-background text-text outline-none focus-within:ring-1 focus-within:ring-primary whitespace-pre-wrap wrap-break-word"
					onInput={this.handleInput}
					onKeyDown={this.handleKeyDown}
					onKeyUp={this.handleSelectionChange}
					onMouseUp={this.handleSelectionChange}
					onPaste={this.handlePaste}
					onClick={this.handleEditorClick}
					onChange={this.handleEditorChange}
					onFocus={this.handleSelectionChange}
				/>
			</div>
		);
	}
}
