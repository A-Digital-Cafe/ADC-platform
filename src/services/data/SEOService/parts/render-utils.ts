import type { ArticleMeta, PageMeta } from "./types.js";

export function htmlEscape(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function metaTag(name: string, content: string | undefined, attr: "name" | "property" = "name"): string {
	if (!content) return "";
	return `<meta ${attr}="${name}" content="${htmlEscape(content)}">`;
}

export function linkTag(rel: string, href: string): string {
	return `<link rel="${rel}" href="${htmlEscape(href)}">`;
}

export function absolutize(url: string, origin: string): string {
	if (/^https?:\/\//i.test(url)) return url;
	if (url.startsWith("//")) return url;
	if (url.startsWith("/")) return `${origin}${url}`;
	return url;
}

function toIso(value?: string | Date): string | undefined {
	if (!value) return undefined;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function formatTitle(meta: PageMeta): string | undefined {
	if (!meta.title) return undefined;
	if (!meta.titleTemplate) return meta.title;
	return meta.titleTemplate.replace("%s", meta.title);
}

function toArray<T>(v: T | T[] | undefined): T[] {
	if (v == null) return [];
	return Array.isArray(v) ? v : [v];
}

export function renderArticleTags(article: ArticleMeta): string[] {
	const out: string[] = [];
	const pub = toIso(article.publishedTime);
	const mod = toIso(article.modifiedTime);
	if (pub) out.push(metaTag("article:published_time", pub, "property"));
	if (mod) out.push(metaTag("article:modified_time", mod, "property"));
	for (const a of toArray(article.author)) out.push(metaTag("article:author", a, "property"));
	if (article.section) out.push(metaTag("article:section", article.section, "property"));
	for (const t of toArray(article.tag)) out.push(metaTag("article:tag", t, "property"));
	return out;
}
