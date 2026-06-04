import { Component, Prop, Event, EventEmitter, Element, Host } from "@stencil/core";
import { sanitizeRichHtml, htmlToPlainText } from "../../../utils/html-sanitizer";

export interface MailComposerChange {
	html: string;
	text: string;
}

/**
 * Editor de texto enriquecido para el cuerpo de un correo. Usa `contenteditable`
 * y produce HTML saneado (lista blanca). Soporta negrita, cursiva, subrayado,
 * tachado, listas, color de texto y resaltado, y enlaces. No usa bloques.
 *
 * - `shadow: false` para que el HTML editado herede los estilos de la app.
 * - Emite `adcMailChange` con `{ html, text }` ya saneados.
 * - Emite `adcRequestAttachment` para que el consumidor adjunte archivos.
 */
@Component({
	tag: "adc-mail-composer",
	styleUrl: "adc-mail-composer.css",
	shadow: false,
})
export class AdcMailComposer {
	@Prop({ mutable: true }) value: string = "";
	@Prop() placeholder: string = "Escribe tu mensaje...";
	@Prop() minHeight: number = 240;
	@Prop() disabled: boolean = false;

	@Element() host!: HTMLElement;

	@Event() adcMailChange!: EventEmitter<MailComposerChange>;
	@Event() adcRequestAttachment!: EventEmitter<void>;

	private editorEl: HTMLDivElement | null = null;

	componentDidLoad() {
		if (this.editorEl && this.value) {
			this.editorEl.innerHTML = sanitizeRichHtml(this.value);
		}
	}

	private focusEditor() {
		this.editorEl?.focus();
	}

	private exec(command: string, arg?: string) {
		if (this.disabled) return;
		this.focusEditor();
		document.execCommand(command, false, arg);
		this.emitChange();
	}

	private readonly onColor = (event: Event) => {
		const input = event.target as HTMLInputElement;
		this.exec("foreColor", input.value);
	};

	private readonly onHighlight = (event: Event) => {
		const input = event.target as HTMLInputElement;
		// `hiliteColor` no funciona en todos los navegadores; `backColor` es el fallback.
		this.focusEditor();
		if (!document.execCommand("hiliteColor", false, input.value)) {
			document.execCommand("backColor", false, input.value);
		}
		this.emitChange();
	};

	private readonly onLink = () => {
		if (this.disabled) return;
		const url = globalThis.prompt("Introduce la URL del enlace (https:// o mailto:)");
		if (!url) return;
		this.exec("createLink", url);
	};

	private readonly emitChange = () => {
		if (!this.editorEl) return;
		const html = sanitizeRichHtml(this.editorEl.innerHTML);
		this.adcMailChange.emit({ html, text: htmlToPlainText(html) });
	};

	private toolbarButton(label: string, title: string, onClick: () => void) {
		return (
			<button
				type="button"
				class="adc-mail-composer__btn"
				title={title}
				aria-label={title}
				onMouseDown={(e) => e.preventDefault()}
				onClick={onClick}
				disabled={this.disabled}
			>
				{label}
			</button>
		);
	}

	render() {
		return (
			<Host class="adc-mail-composer">
				<div class="adc-mail-composer__toolbar" role="toolbar" aria-label="Formato de texto">
					{this.toolbarButton("B", "Negrita", () => this.exec("bold"))}
					{this.toolbarButton("I", "Cursiva", () => this.exec("italic"))}
					{this.toolbarButton("U", "Subrayado", () => this.exec("underline"))}
					{this.toolbarButton("S", "Tachado", () => this.exec("strikeThrough"))}
					<span class="adc-mail-composer__sep" />
					{this.toolbarButton("•", "Lista", () => this.exec("insertUnorderedList"))}
					{this.toolbarButton("1.", "Lista numerada", () => this.exec("insertOrderedList"))}
					<span class="adc-mail-composer__sep" />
					<label class="adc-mail-composer__color" title="Color de texto">
						<span aria-hidden="true">A</span>
						<input type="color" aria-label="Color de texto" onInput={this.onColor} disabled={this.disabled} />
					</label>
					<label class="adc-mail-composer__color adc-mail-composer__color--highlight" title="Resaltado">
						<span aria-hidden="true">A</span>
						<input
							type="color"
							aria-label="Color de resaltado"
							value="#fff176"
							onInput={this.onHighlight}
							disabled={this.disabled}
						/>
					</label>
					<span class="adc-mail-composer__sep" />
					{this.toolbarButton("🔗", "Enlace", this.onLink)}
					{this.toolbarButton("🧹", "Limpiar formato", () => this.exec("removeFormat"))}
					<span class="adc-mail-composer__spacer" />
					{this.toolbarButton("📎", "Adjuntar archivo", () => this.adcRequestAttachment.emit())}
				</div>
				<div
					class="adc-mail-composer__input"
					contentEditable={!this.disabled}
					role="textbox"
					aria-multiline="true"
					aria-label={this.placeholder}
					tabindex={0}
					data-placeholder={this.placeholder}
					style={{ minHeight: `${this.minHeight}px` }}
					ref={(el) => (this.editorEl = el as HTMLDivElement)}
					onInput={this.emitChange}
					onBlur={this.emitChange}
				/>
			</Host>
		);
	}
}
