import { Component, Prop } from "@stencil/core";

import { isPlatformLink } from "../../../../utils/platform-links.js";

export interface InlineToken {
	type: "text" | "bold" | "italic" | "strike" | "code" | "link";
	content: string;
	/** Destino del enlace, sólo para `type === "link"`. */
	href?: string;
}

// Regex para detectar tokens inline: [texto](url), **bold**, *italic*, ~~strike~~, `code`
const INLINE_PATTERN = /\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\*[^*]+\*/g;

// Acepta http(s) y rutas relativas; descarta esquemas peligrosos (javascript:, data:).
function sanitizeHref(href: string): string | null {
	const value = href.trim();
	if (!value) return null;
	if (value.startsWith("/") || value.startsWith("#")) return value;
	if (/^https?:\/\//i.test(value)) return value;
	return null;
}

// Decodifica secuencias \u003C, \u003E, \u0026 guardadas para evitar XSS
function decodeEscapes(s?: string): string {
	if (typeof s !== "string") return s ?? "";
	return s
		.replaceAll(String.raw`\u003C`, "<")
		.replaceAll(String.raw`\u003E`, ">")
		.replaceAll(String.raw`\u0026`, "&");
}

// Parsea texto con formato inline a tokens
function parseInlineTokens(raw?: string): InlineToken[] {
	const decoded = decodeEscapes(raw) || "";
	if (!decoded) return [];

	const tokens: InlineToken[] = [];
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	INLINE_PATTERN.lastIndex = 0;

	while ((match = INLINE_PATTERN.exec(decoded))) {
		if (match.index > lastIndex) {
			tokens.push({ type: "text", content: decoded.slice(lastIndex, match.index) });
		}
		const value = match[0];
		if (value.startsWith("[")) {
			const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(value);
			const href = link ? sanitizeHref(link[2]) : null;
			if (link && href) {
				tokens.push({ type: "link", content: link[1], href });
			} else {
				tokens.push({ type: "text", content: value });
			}
		} else if (value.startsWith("**")) {
			tokens.push({ type: "bold", content: value.slice(2, -2) });
		} else if (value.startsWith("~~")) {
			tokens.push({ type: "strike", content: value.slice(2, -2) });
		} else if (value.startsWith("`")) {
			tokens.push({ type: "code", content: value.slice(1, -1) });
		} else if (value.startsWith("*")) {
			tokens.push({ type: "italic", content: value.slice(1, -1) });
		}
		lastIndex = match.index + value.length;
	}

	if (lastIndex < decoded.length) {
		tokens.push({ type: "text", content: decoded.slice(lastIndex) });
	}
	return tokens;
}

@Component({
	tag: "adc-inline-tokens",
	shadow: false,
})
export class AdcInlineTokens {
	@Prop() tokens: InlineToken[] = [];
	@Prop() fallback: string = "";
	private static readonly keyPrefix = "token-";

	render() {
		// Si no hay tokens pre-parseados, parsear el fallback automáticamente
		const effectiveTokens = this.tokens && this.tokens.length > 0 ? this.tokens : parseInlineTokens(this.fallback);

		if (effectiveTokens.length === 0) {
			return <span style={{ display: "contents" }}>{this.fallback}</span>;
		}
		return (
			<span style={{ display: "contents" }}>
				{effectiveTokens.map((token, idx) => {
					switch (token.type) {
						case "bold":
							return <strong key={AdcInlineTokens.keyPrefix + idx}>{token.content}</strong>;
						case "italic":
							return <em key={AdcInlineTokens.keyPrefix + idx}>{token.content}</em>;
						case "strike":
							return <s key={AdcInlineTokens.keyPrefix + idx}>{token.content}</s>;
						case "code":
							return <code key={AdcInlineTokens.keyPrefix + idx}>{token.content}</code>;
						case "link": {
							const href = token.href || "";
							if (isPlatformLink(href)) {
								return (
									<adc-platform-link
										key={AdcInlineTokens.keyPrefix + idx}
										href={href}
										label={token.content}
									></adc-platform-link>
								);
							}
							return (
								<a
									key={AdcInlineTokens.keyPrefix + idx}
									href={href}
									target="_blank"
									rel="noopener noreferrer"
									class="text-link underline underline-offset-2 hover:no-underline"
								>
									{token.content}
								</a>
							);
						}
						default:
							return (
								<span key={AdcInlineTokens.keyPrefix + idx} style={{ display: "contents" }}>
									{token.content}
								</span>
							);
					}
				})}
			</span>
		);
	}
}
