import { HighlighterStrategy, escapeHtml } from "./types.js";

/**
 * Python syntax highlighter
 */
export class PythonHighlighter implements HighlighterStrategy {
	highlight(code: string): string {
		let escaped = escapeHtml(code);

		const keywordPattern = /\b(def|return|if|elif|else|for|while|class|import|from|as|pass|lambda|try|except|finally|with|yield|raise)\b/g;
		const typePattern = /\b(int|float|str|bool|list|dict|set|tuple)\b/g;
		const functionPattern = /\b(?!if\b|for\b|while\b|class\b|def\b|with\b|lambda\b|try\b|except\b)([A-Za-z_]\w*)\s*(?=\()/g;

		const replacements = new Map<string, string>();
		let placeholderIndex = 0;

		// Strings (with prefixes like f, r, b)
		const doubleStrRegex = /(?:[rRuUbBfF]{0,2})"(?:\\.|[^"\\])*"/g;
		const singleStrRegex = /(?:[rRuUbBfF]{0,2})'(?:\\.|[^'\\])*'/g;
		[doubleStrRegex, singleStrRegex].forEach((regex) => {
			escaped = escaped.replace(regex, (match) => {
				const ph = `__STR_${placeholderIndex++}__`;
				replacements.set(ph, `<span class="token string">${match}</span>`);
				return ph;
			});
		});

		// Triple-quoted strings (docstrings) as comments
		const tripleDoubleRegex = /(?:[rRuUbBfF]{0,2})"""[\s\S]*?"""/g;
		const tripleSingleRegex = /(?:[rRuUbBfF]{0,2})'''[\s\S]*?'''/g;
		[tripleDoubleRegex, tripleSingleRegex].forEach((regex) => {
			escaped = escaped.replace(regex, (match) => {
				const ph = `__COMMENT_${placeholderIndex++}__`;
				replacements.set(ph, `<span class="token comment">${match}</span>`);
				return ph;
			});
		});

		// Line comments (`.` ya no cruza `\n`; el `$` era redundante y disparaba S8786)
		const lineCommentRegex = /#.*/g;
		escaped = escaped.replaceAll(lineCommentRegex, (match) => {
			const ph = `__COMMENT_${placeholderIndex++}__`;
			replacements.set(ph, `<span class="token comment">${match}</span>`);
			return ph;
		});

		// Apply token replacements
		escaped = escaped.replaceAll(keywordPattern, '<span class="token keyword">$1</span>');
		escaped = escaped.replaceAll(typePattern, '<span class="token type">$1</span>');
		escaped = escaped.replaceAll(functionPattern, '<span class="token function">$1</span>');

		// Restore placeholders
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
}
