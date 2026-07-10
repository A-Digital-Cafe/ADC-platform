/**
 * Sanitizador de HTML enriquecido sin dependencias externas. Usa el parser del
 * navegador y una lista blanca de etiquetas/atributos. Pensado para el cuerpo de
 * correos: texto con formato, color de texto y resaltado, listas y enlaces.
 *
 * Es la frontera de confianza tanto en composición (al emitir el HTML) como en
 * visualización (al renderizar HTML recibido de terceros).
 */

const ALLOWED_TAGS = new Set([
	"p",
	"br",
	"div",
	"span",
	"b",
	"strong",
	"i",
	"em",
	"u",
	"s",
	"strike",
	"a",
	"ul",
	"ol",
	"li",
	"blockquote",
	"h1",
	"h2",
	"h3",
	"pre",
	"code",
]);

const ALLOWED_STYLE_PROPS = new Set(["color", "background-color", "font-weight", "font-style", "text-decoration"]);

// Sólo se permiten colores hex/rgb(a)/nombres simples para evitar `url()`, `expression()`, etc.
const HEX_RX = /^#[0-9a-fA-F]{3,8}$/;
const RGB_RX = /^rgba?\([\d.,\s]+\)$/;
const NAME_RX = /^[a-zA-Z-]+$/;

function isSafeColor(value: string): boolean {
	return HEX_RX.test(value) || RGB_RX.test(value) || NAME_RX.test(value);
}

function sanitizeStyle(style: string): string {
	const out: string[] = [];
	for (const decl of style.split(";")) {
		const idx = decl.indexOf(":");
		if (idx === -1) continue;
		const prop = decl.slice(0, idx).trim().toLowerCase();
		const value = decl.slice(idx + 1).trim();
		if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
		if (!isSafeColor(value)) continue;
		out.push(`${prop}: ${value}`);
	}
	return out.join("; ");
}

function sanitizeHref(href: string): string | null {
	const value = href.trim();
	if (/^(https?:|mailto:)/i.test(value)) return value;
	return null;
}

function unwrap(el: Element): void {
	const parent = el.parentNode;
	if (!parent) {
		el.remove();
		return;
	}
	while (el.firstChild) parent.insertBefore(el.firstChild, el);
	el.remove();
}

function sanitizeAttributes(el: Element, tag: string): void {
	for (const attr of Array.from(el.attributes)) {
		const name = attr.name.toLowerCase();
		if (name === "style") {
			const safe = sanitizeStyle(attr.value);
			if (safe) el.setAttribute("style", safe);
			else el.removeAttribute("style");
		} else if (tag === "a" && name === "href") {
			const safe = sanitizeHref(attr.value);
			if (safe) el.setAttribute("href", safe);
			else el.removeAttribute("href");
		} else if (!(tag === "a" && (name === "target" || name === "rel"))) {
			el.removeAttribute(attr.name);
		}
	}
}

function sanitizeElement(el: Element): void {
	const tag = el.tagName.toLowerCase();
	if (!ALLOWED_TAGS.has(tag)) {
		unwrap(el);
		return;
	}
	sanitizeAttributes(el, tag);
	if (tag === "a") {
		el.setAttribute("target", "_blank");
		el.setAttribute("rel", "noopener noreferrer nofollow");
	}
}

function walk(node: Node): void {
	const children = Array.from(node.childNodes);
	for (const child of children) {
		if (child.nodeType === Node.ELEMENT_NODE) {
			walk(child); // primero hijos para no perder contenido al desempaquetar
			sanitizeElement(child as Element);
		} else if (child.nodeType !== Node.TEXT_NODE) {
			(child as ChildNode).remove();
		}
	}
}

/** Devuelve una versión saneada (lista blanca) del HTML recibido. */
export function sanitizeRichHtml(html: string): string {
	if (!html) return "";
	const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
	const root = doc.body.firstElementChild;
	if (!root) return "";
	walk(root);
	return root.innerHTML;
}

/** Extrae texto plano de un fragmento HTML (para previews/bodyText). */
export function htmlToPlainText(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	// Recorte de espacios al final de cada línea sin regex: el patrón `X+\n`
	// tiene backtracking super-lineal (typescript:S8786) al escanear cada
	// posición de una corrida de espacios que no termina en `\n`.
	return (doc.body.textContent || "")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}
