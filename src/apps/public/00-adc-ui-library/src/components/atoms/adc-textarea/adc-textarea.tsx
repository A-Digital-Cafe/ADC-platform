import { Component, Prop, Host, Element } from "@stencil/core";

let textareaUid = 0;

@Component({
	tag: "adc-textarea",
	shadow: false,
})
export class AdcTextarea {
	@Prop() value: string = "";
	@Prop() placeholder?: string = "";
	@Prop() textareaId?: string = "";
	@Prop() name?: string = "";
	@Prop() rows?: number = 3;
	@Prop() ariaLabel?: string = "";
	@Prop() disabled?: boolean = false;
	/** Sólo lectura: se puede seleccionar y copiar, pero no editar. */
	@Prop() readOnly?: boolean = false;
	/** Marca el campo como requerido en su formulario. */
	@Prop() required?: boolean = false;
	/** Cantidad máxima de caracteres. */
	@Prop() maxLength?: number;
	/** Mensaje de error inline; activa el estado inválido (borde danger + aria-invalid). */
	@Prop() error?: string;
	/** Marca el campo como inválido sin texto. */
	@Prop() invalid?: boolean = false;
	/** Texto de ayuda neutro bajo el campo. Se ignora si hay `error`. */
	@Prop() hint?: string;
	/** Crece con el contenido desde `rows` hasta `maxRows` (después scrollea). Sin manija de resize. */
	@Prop() autoGrow?: boolean = false;
	/** Tope de filas con `autoGrow`. */
	@Prop() maxRows?: number = 8;

	@Element() el!: HTMLElement;

	private readonly uid = `adc-textarea-${textareaUid++}`;

	componentDidRender() {
		this.fit();
	}

	/** Ajusta la altura al contenido. Corre tras cada render para cubrir también el vaciado desde afuera. */
	private readonly fit = () => {
		if (!this.autoGrow) return;
		const area = this.el.querySelector("textarea");
		if (!area) return;
		const style = getComputedStyle(area);
		const px = (v: string) => Number.parseFloat(v) || 0;
		const line = px(style.lineHeight) || px(style.fontSize) * 1.4 || 18;
		// `border-box`: la altura incluye el borde, que `scrollHeight` no cuenta.
		const borders = px(style.borderTopWidth) + px(style.borderBottomWidth);
		const max = line * (this.maxRows ?? 8) + px(style.paddingTop) + px(style.paddingBottom) + borders;
		area.style.height = "auto";
		const wanted = area.scrollHeight + borders;
		area.style.height = `${Math.min(wanted, max)}px`;
		area.style.overflowY = wanted > max ? "auto" : "hidden";
	};

	private get isInvalid(): boolean {
		return this.invalid || !!this.error;
	}

	private get messageId(): string | undefined {
		if (!this.error && !this.hint) return undefined;
		return `${this.textareaId || this.name || this.uid}-msg`;
	}

	private renderMessage(messageId: string | undefined) {
		if (this.error) {
			return (
				<span id={messageId} role="alert" class="mt-1 block font-text text-[11px] text-tdanger">
					{this.error}
				</span>
			);
		}
		if (this.hint) {
			return (
				<span id={messageId} class="mt-1 block font-text text-[11px] text-muted">
					{this.hint}
				</span>
			);
		}
		return null;
	}

	render() {
		const messageId = this.messageId;
		return (
			<Host class="block">
				{/* El valor va como propiedad y no como contenido: como hijo sólo fija el valor
				    inicial, así que en cuanto alguien escribe el campo deja de responder a la
				    prop y no hay forma de vaciarlo desde afuera. */}
				<textarea
					id={this.textareaId}
					name={this.name}
					placeholder={this.placeholder}
					rows={this.rows}
					disabled={this.disabled}
					readOnly={this.readOnly}
					required={this.required}
					maxlength={this.maxLength}
					aria-label={this.ariaLabel || this.placeholder || this.name}
					aria-invalid={this.isInvalid ? "true" : undefined}
					aria-describedby={messageId}
					class={`w-full px-3 py-2 rounded-xxl border bg-surface font-text text-[12px] text-text ${this.autoGrow ? "resize-none" : "resize-y"} disabled:opacity-50 disabled:cursor-not-allowed ${this.isInvalid ? "border-danger" : "border-text/15"}`}
					value={this.value}
					onInput={this.fit}
				/>
				{this.renderMessage(messageId)}
			</Host>
		);
	}
}
