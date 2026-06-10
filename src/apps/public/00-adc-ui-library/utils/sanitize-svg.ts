/**
 * Sanitizador de SVG con allowlist para iconos inyectados vía `innerHTML`.
 *
 * Los props de icono (`iconSvg`, `icon`) aceptan markup arbitrario del consumidor;
 * este sanitizador garantiza que solo se rendericen elementos/atributos SVG seguros
 * (sin scripts, handlers `on*`, `foreignObject` ni referencias externas).
 */

const ALLOWED_TAGS = new Set([
	"svg",
	"path",
	"g",
	"circle",
	"rect",
	"line",
	"polyline",
	"polygon",
	"ellipse",
	"defs",
	"lineargradient",
	"radialgradient",
	"stop",
	"clippath",
	"mask",
	"use",
	"title",
	"desc",
	"symbol",
	"pattern",
	"marker",
	"text",
	"tspan",
]);

function sanitizeElement(el: Element): void {
	// Snapshot: se mutan children/attributes durante la iteración (colecciones vivas)
	const children = Array.from(el.children);
	for (const child of children) {
		if (!ALLOWED_TAGS.has(child.tagName.toLowerCase())) {
			child.remove();
			continue;
		}
		sanitizeElement(child);
	}
	const attributes = Array.from(el.attributes);
	for (const attr of attributes) {
		const name = attr.name.toLowerCase();
		const value = attr.value.trim().toLowerCase();
		// Handlers de eventos y URIs ejecutables fuera (solo referencias internas "#id")
		if (name.startsWith("on") || ((name === "href" || name === "xlink:href") && !value.startsWith("#"))) {
			el.removeAttribute(attr.name);
		}
	}
}

/**
 * Devuelve el SVG sanitizado, o cadena vacía si el markup no es un SVG válido
 * (o si no hay DOM disponible, p.ej. SSR).
 */
export function sanitizeSvg(svg: string): string {
	if (!svg) return "";
	if (typeof DOMParser === "undefined") return "";

	const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
	const root = doc.documentElement;
	if (root.nodeName === "parsererror" || root.tagName.toLowerCase() !== "svg") return "";

	sanitizeElement(root);
	return root.outerHTML;
}
