import { HighlighterStrategy, escapeHtml } from "./types.js";

/**
 * C++ syntax highlighter (also used for C)
 */
export class CppHighlighter implements HighlighterStrategy {
	highlight(code: string): string {
		let escaped = escapeHtml(code);

		const replacements = new Map<string, string>();
		let placeholderIndex = 0;

		// Comments (`.` ya no cruza `\n`; el `$` era redundante y disparaba S8786)
		const lineCommentRegex = /\/\/.*/g;
		const blockCommentRegex = /\/\*[\s\S]*?\*\//g;
		escaped = escaped.replaceAll(lineCommentRegex, (match) => {
			const placeholder = `__COMMENT_${placeholderIndex++}__`;
			replacements.set(placeholder, `<span class="token comment">${match}</span>`);
			return placeholder;
		});
		escaped = escaped.replaceAll(blockCommentRegex, (match) => {
			const placeholder = `__COMMENT_${placeholderIndex++}__`;
			replacements.set(placeholder, `<span class="token comment">${match}</span>`);
			return placeholder;
		});

		// Functions
		const functionRegex = /\b(main|printf|scanf|cout|cin|endl|malloc|free|strlen|strcpy|strcmp|sizeof)\b(?=\s*\()/g;
		escaped = escaped.replaceAll(functionRegex, (_, func) => {
			const placeholder = `__FUNC_${placeholderIndex++}__`;
			replacements.set(placeholder, `<span class="token function">${func}</span>`);
			return placeholder;
		});

		// Keywords
		const keywordRegexA = /\b(auto|break|case|catch|class|const|continue|default|delete|do|else|enum|explicit|extern)\b/g;
		const keywordRegexB = /\b(false|for|friend|goto|if|inline|mutable|namespace|new|nullptr|operator|private)\b/g;
		const keywordRegexC = /\b(protected|public|register|return|sizeof|static|struct|switch|template|this|throw)\b/g;
		const keywordRegexD = /\b(true|try|typedef|typename|union|using|virtual|void|volatile|while)\b/g;
		[keywordRegexA, keywordRegexB, keywordRegexC, keywordRegexD].forEach((regex) => {
			escaped = escaped.replace(regex, (_, keyword) => {
				const placeholder = `__KEYWORD_${placeholderIndex++}__`;
				replacements.set(placeholder, `<span class="token keyword">${keyword}</span>`);
				return placeholder;
			});
		});

		// Types
		const typeRegex =
			/\b(bool|char|double|float|int|long|short|signed|unsigned|wchar_t|string|vector|map|set|list|queue|stack|array|pair)\b/g;
		escaped = escaped.replaceAll(typeRegex, (_, type) => {
			const placeholder = `__TYPE_${placeholderIndex++}__`;
			replacements.set(placeholder, `<span class="token type">${type}</span>`);
			return placeholder;
		});

		// Preprocessor
		const preprocessorRegex = /^#include\b|^#define\b/gm;
		escaped = escaped.replaceAll(preprocessorRegex, (match) => {
			const placeholder = `__PREPROC_${placeholderIndex++}__`;
			replacements.set(placeholder, `<span class="token preprocessor">${match}</span>`);
			return placeholder;
		});

		// Operators
		const operatorRegex = /(&lt;&lt;|&gt;&gt;|::)/g;
		escaped = escaped.replaceAll(operatorRegex, (match) => {
			const placeholder = `__OP_${placeholderIndex++}__`;
			replacements.set(placeholder, `<span class="token operator">${match}</span>`);
			return placeholder;
		});

		// Restore placeholders
		for (const [placeholder, html] of replacements) {
			escaped = escaped.replace(placeholder, () => html);
		}

		return escaped;
	}
}
