import { Component, Prop } from "@stencil/core";
import { getHighlighter, escapeHtml, decodeEscapes } from "../../../utils/highlighter";

@Component({
	tag: "adc-code-block",
	styleUrl: "adc-code-block.css",
	shadow: false,
})
export class AdcCodeBlock {
	@Prop() language?: string;
	@Prop() content: string = "";
	@Prop() ariaLabel?: string;

	private getHighlightedContent(): string {
		const decoded = decodeEscapes(this.content);
		if (!this.language) {
			return escapeHtml(decoded);
		}
		// Contrato de seguridad: toda HighlighterStrategy DEBE escapar el input con
		// escapeHtml() ANTES de envolver tokens en <span>. El innerHTML de abajo confía en ello.
		const highlighter = getHighlighter(this.language);
		return highlighter ? highlighter.highlight(decoded) : escapeHtml(decoded);
	}

	render() {
		const highlightedContent = this.getHighlightedContent();
		const codeClass = this.language
			? `block p-3 whitespace-pre break-normal language-${this.language} lang-${this.language}`
			: "block p-3 whitespace-pre break-normal";

		return (
			<figure
				class="bg-alt text-text rounded-xxl px-6 pb-2 pt-4 ml-8 overflow-x-auto text-md mb-2 font-mono break-normal xl:max-w-[80vw]"
				aria-label={this.ariaLabel}
			>
				{this.language && <figcaption class="text-blue-800">[{this.language}]</figcaption>}
				<code class={codeClass} innerHTML={highlightedContent}></code>
			</figure>
		);
	}
}
