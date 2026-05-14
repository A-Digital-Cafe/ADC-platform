export { escapeHtml, type HighlighterStrategy } from "./strategies/types.js";

import {
	type HighlighterStrategy,
	JavaScriptHighlighter,
	TypeScriptHighlighter,
	PythonHighlighter,
	JavaHighlighter,
	CppHighlighter,
} from "./strategies/index.js";

/**
 * Decodes unicode escape sequences stored to bypass XSS validators
 * e.g., \u003C -> <, \u003E -> >, \u0026 -> &
 */
export function decodeEscapes(s?: string): string {
	if (typeof s !== "string") return s ?? "";
	return s
		.replaceAll(String.raw`\u003C`, "<")
		.replaceAll(String.raw`\u003E`, ">")
		.replaceAll(String.raw`\u0026`, "&");
}

// =============================================================================
// Highlighter Registry
// =============================================================================
const strategies: Map<string, HighlighterStrategy> = new Map([
	["javascript", new JavaScriptHighlighter()],
	["js", new JavaScriptHighlighter()],
	["typescript", new TypeScriptHighlighter()],
	["ts", new TypeScriptHighlighter()],
	["python", new PythonHighlighter()],
	["py", new PythonHighlighter()],
	["java", new JavaHighlighter()],
	["cpp", new CppHighlighter()],
	["c++", new CppHighlighter()],
	["c", new CppHighlighter()],
]);

export function getHighlighter(language: string): HighlighterStrategy | undefined {
	return strategies.get(language.toLowerCase());
}
