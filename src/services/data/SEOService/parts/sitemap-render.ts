import type { SitemapEntry } from "./types.js";

function xmlEscape(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function toIsoDate(value: string | Date | undefined): string | undefined {
	if (!value) return undefined;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function renderSitemapXml(baseUrl: string, entries: SitemapEntry[]): string {
	const urls = entries
		.map((e) => {
			const path = e.path.startsWith("/") ? e.path : `/${e.path}`;
			const absoluteUrl = `${baseUrl}${path}`;
			const parts: string[] = [`<loc>${xmlEscape(absoluteUrl)}</loc>`];
			const iso = toIsoDate(e.lastmod);
			if (iso) parts.push(`<lastmod>${iso}</lastmod>`);
			if (e.changefreq) parts.push(`<changefreq>${e.changefreq}</changefreq>`);
			if (typeof e.priority === "number") {
				const p = Math.max(0, Math.min(1, e.priority));
				parts.push(`<priority>${p.toFixed(1)}</priority>`);
			}
			return `	<url>${parts.join("")}</url>`;
		})
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export interface SitemapIndexEntry {
	loc: string;
	lastmod?: string | Date;
}

export function renderSitemapIndexXml(entries: SitemapIndexEntry[]): string {
	const items = entries
		.map((e) => {
			const parts: string[] = [`<loc>${xmlEscape(e.loc)}</loc>`];
			const iso = toIsoDate(e.lastmod);
			if (iso) parts.push(`<lastmod>${iso}</lastmod>`);
			return `	<sitemap>${parts.join("")}</sitemap>`;
		})
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}
