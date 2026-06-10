/**
 * Utilidades de escape compartidas (única fuente de verdad).
 *
 * No reimplementar estos helpers en services/presets: importarlos desde
 * `@common/utils/escape.ts`. Un bug de escaping se parchea en un solo lugar.
 */

/** Escapa los metacaracteres de regex de un string (para `$regex` de Mongo, RegExp dinámicas, etc.). */
export function escapeRegex(value: string): string {
	return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Escapa entidades HTML (`& < > " '`). Para interpolar texto en markup HTML. */
export function escapeHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Escapa entidades XML (`& < > " '`). Para sitemaps, feeds y documentos XML. */
export function escapeXml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
