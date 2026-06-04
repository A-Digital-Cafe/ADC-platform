import { Component, Prop, Watch, Element, Host } from "@stencil/core";
import { sanitizeRichHtml } from "../../../utils/html-sanitizer";

/**
 * Renderiza el cuerpo HTML de un correo de forma segura. Aplica la lista blanca
 * de `sanitizeRichHtml` antes de inyectar el contenido, evitando XSS almacenado.
 * `shadow: false` para que el contenido herede la tipografía de la app.
 */
@Component({
	tag: "adc-mail-viewer",
	styleUrl: "adc-mail-viewer.css",
	shadow: false,
})
export class AdcMailViewer {
	@Prop() html: string = "";

	@Element() host!: HTMLElement;

	private contentEl: HTMLDivElement | null = null;

	componentDidLoad() {
		this.renderContent();
	}

	@Watch("html")
	onHtmlChange() {
		this.renderContent();
	}

	private renderContent() {
		if (this.contentEl) {
			this.contentEl.innerHTML = sanitizeRichHtml(this.html);
		}
	}

	render() {
		return (
			<Host class="adc-mail-viewer">
				<div class="adc-mail-viewer__content" ref={(el) => (this.contentEl = el as HTMLDivElement)} />
			</Host>
		);
	}
}
