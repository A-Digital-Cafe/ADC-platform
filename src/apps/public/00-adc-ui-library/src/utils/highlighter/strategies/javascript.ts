import { HighlighterStrategy, escapeHtml } from "./types.js";

/**
 * Shared highlighting pipeline for JS-family languages.
 * Handles template literals, strings, comments, placeholder restoration,
 * and delegates keyword/type/function token replacement to `applyTokenReplacements`.
 */
export function highlightJSFamily(
	escaped: string,
	applyTokenReplacements: (input: string) => string,
	preTokenSteps: { regex: RegExp; replacer: (match: string, ...groups: string[]) => string }[] = []
): string {
	const replacements = new Map<string, string>();
	const rawByPlaceholder = new Map<string, string>();
	let placeholderIndex = 0;

	// Template literals with ${} interpolation
	const tplRegex = /`(?:\\.|[\s\S])*?`/g;
	escaped = escaped.replaceAll(tplRegex, (match) => {
		const inner = match.slice(1, -1);
		const exprRe = /\$\{([\s\S]*?)\}/g;
		let out = '<span class="token string">`</span>';
		let last = 0;
		let m: RegExpExecArray | null;
		while ((m = exprRe.exec(inner))) {
			if (m.index > last) out += `<span class="token string">${inner.slice(last, m.index)}</span>`;
			out += '<span class="token punctuation">${</span>';
			out += applyTokenReplacements(m[1] ?? "");
			out += '<span class="token punctuation">}</span>';
			last = exprRe.lastIndex;
		}
		if (last < inner.length) out += `<span class="token string">${inner.slice(last)}</span>`;
		out += '<span class="token string">`</span>';
		const placeholder = `__TPL_${placeholderIndex++}__`;
		replacements.set(placeholder, out);
		rawByPlaceholder.set(placeholder, match);
		return placeholder;
	});

	// Strings (double and single quotes)
	const doubleRegex = /"(?:\\.|[^"\\])*"/g;
	const singleRegex = /'(?:\\.|[^'\\])*'/g;
	[doubleRegex, singleRegex].forEach((regex) => {
		escaped = escaped.replace(regex, (match) => {
			const placeholder = `__STR_${placeholderIndex++}__`;
			replacements.set(placeholder, `<span class="token string">${match}</span>`);
			rawByPlaceholder.set(placeholder, match);
			return placeholder;
		});
	});

	// Comments (line and block)
	const lineCommentRegex = /\/\/[^\n]*/g;
	const blockCommentRegex = /\/\*[\s\S]*?\*\//g;
	const neutralizeInsideComment = (text: string): string =>
		text.replaceAll(/__TPL_\d+__|__STR_\d+__/g, (ph) => rawByPlaceholder.get(ph) ?? ph);

	escaped = escaped.replaceAll(lineCommentRegex, (match) => {
		const placeholder = `__COMMENT_${placeholderIndex++}__`;
		replacements.set(placeholder, `<span class="token comment">${neutralizeInsideComment(match)}</span>`);
		return placeholder;
	});
	escaped = escaped.replaceAll(blockCommentRegex, (match) => {
		const placeholder = `__COMMENT_${placeholderIndex++}__`;
		replacements.set(placeholder, `<span class="token comment">${neutralizeInsideComment(match)}</span>`);
		return placeholder;
	});

	// Pre-token steps (language-specific, e.g. `new ClassName`)
	for (const step of preTokenSteps) {
		escaped = escaped.replace(step.regex, (...args) => {
			const match = args[0];
			const groups = args.slice(1, -2) as string[];
			const result = step.replacer(match, ...groups);
			const placeholder = `__PRE_${placeholderIndex++}__`;
			replacements.set(placeholder, result);
			return placeholder;
		});
	}

	// Apply token replacements (keywords, types, functions)
	escaped = applyTokenReplacements(escaped);

	// Restore all placeholders
	if (replacements.size) {
		const keys = Array.from(replacements.keys());
		let changed = true;
		while (changed) {
			changed = false;
			for (const key of keys) {
				const html = replacements.get(key)!;
				if (escaped.includes(key)) {
					escaped = escaped.replace(key, () => html);
					changed = true;
				}
			}
		}
	}

	return escaped;
}

const keywordPatternA = /\b(function|return|if|else|for|while|class|const|let|var)\b/g;
const keywordPatternB = /\b(import|from|export|new|switch|case|break|try|catch|finally|throw)\b/g;
const typePattern = /\b(string|number|boolean|any|void|unknown|never)\b/g;
const functionPattern = /\b(?!if\b|for\b|while\b|switch\b|catch\b)([A-Za-z_]\w*)\s*(?=\()/g;

function applyJSTokenReplacements(input: string): string {
	let out = input;
	out = out.replaceAll(keywordPatternA, '<span class="token keyword">$1</span>');
	out = out.replaceAll(keywordPatternB, '<span class="token keyword">$1</span>');
	out = out.replaceAll(typePattern, '<span class="token type">$1</span>');
	out = out.replaceAll(functionPattern, '<span class="token function">$1</span>');
	return out;
}

/**
 * JavaScript syntax highlighter
 */
export class JavaScriptHighlighter implements HighlighterStrategy {
	highlight(code: string): string {
		return highlightJSFamily(escapeHtml(code), applyJSTokenReplacements);
	}
}
