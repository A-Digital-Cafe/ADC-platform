import type { PageMeta } from "./types.js";
import { absolutize, formatTitle, htmlEscape, linkTag, metaTag, renderArticleTags } from "./render-utils.js";

function renderOgTags(meta: PageMeta, urlPath: string, origin: string): string[] {
	const og = meta.og;
	if (!og) return [];
	const out: string[] = [
		metaTag("og:title", og.title ?? meta.title, "property"),
		metaTag("og:description", og.description ?? meta.description, "property"),
		metaTag("og:type", og.type ?? "website", "property"),
		metaTag("og:url", absolutize(og.url ?? urlPath, origin), "property"),
		metaTag("og:site_name", og.siteName, "property"),
		metaTag("og:locale", og.locale, "property"),
	];
	if (og.image) {
		out.push(
			metaTag("og:image", absolutize(og.image.url, origin), "property"),
			og.image.width ? metaTag("og:image:width", String(og.image.width), "property") : "",
			og.image.height ? metaTag("og:image:height", String(og.image.height), "property") : "",
			metaTag("og:image:alt", og.image.alt, "property"),
		);
	}
	return out;
}

function renderTwitterTags(meta: PageMeta, origin: string): string[] {
	const tw = meta.twitter;
	if (!tw) return [];
	return [
		metaTag("twitter:card", tw.card ?? "summary"),
		metaTag("twitter:title", tw.title ?? meta.title),
		metaTag("twitter:description", tw.description ?? meta.description),
		tw.image ? metaTag("twitter:image", absolutize(tw.image, origin)) : "",
		metaTag("twitter:site", tw.site),
		metaTag("twitter:creator", tw.creator),
	];
}

function renderExtraTags(extra: PageMeta["extra"]): string[] {
	if (!extra) return [];
	return extra.map((tag) => {
		const attrs = Object.entries(tag.attrs)
			.map(([k, v]) => `${k}="${htmlEscape(v)}"`)
			.join(" ");
		return `<${tag.tag} ${attrs}>`;
	});
}

function renderJsonLd(jsonLd: PageMeta["jsonLd"]): string[] {
	if (!jsonLd) return [];
	const data = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
	const escapeEnd = String.raw`<\/`;
	return data.map((obj) => {
		const json = JSON.stringify(obj).replaceAll("</", escapeEnd);
		return `<script type="application/ld+json">${json}</script>`;
	});
}

export function renderHeadTags(meta: PageMeta, origin: string, urlPath: string): string {
	const title = formatTitle(meta);
	const canonical = absolutize(meta.canonical ?? urlPath, origin);
	const parts: string[] = [
		"<!--SEO-->",
		title ? `<title>${htmlEscape(title)}</title>` : "",
		metaTag("description", meta.description),
		metaTag("robots", meta.robots),
		linkTag("canonical", canonical),
		...renderOgTags(meta, urlPath, origin),
		...renderTwitterTags(meta, origin),
		...(meta.article ? renderArticleTags(meta.article) : []),
		...renderExtraTags(meta.extra),
		...renderJsonLd(meta.jsonLd),
		"<!--/SEO-->",
	];
	return parts.filter(Boolean).join("");
}
