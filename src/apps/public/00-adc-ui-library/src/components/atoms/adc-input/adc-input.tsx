import { Component, Prop, Element, Host } from "@stencil/core";

let inputUid = 0;

@Component({
	tag: "adc-input",
	shadow: false,
})
export class AdcInput {
	@Element() el!: HTMLElement;

	@Prop() value: string = "";
	@Prop() placeholder?: string = "";
	@Prop() inputId?: string = "";
	@Prop() name?: string = "";
	@Prop() type?: string = "text";
	@Prop() autocomplete?: string = "off";
	@Prop() ariaLabel?: string = "";
	@Prop() disabled?: boolean = false;
	/** Cantidad máxima de caracteres. */
	@Prop() maxLength?: number;
	/** Mínimo / máximo / paso (para `type="number"`). */
	@Prop() min?: number | string;
	@Prop() max?: number | string;
	@Prop() step?: number | string;
	/** Marca el campo como requerido en su formulario. */
	@Prop() required?: boolean = false;
	/** Campo de solo lectura. */
	@Prop() readOnly?: boolean = false;
	/** Foca el input al montar (equivalente al `autoFocus` de un input nativo). */
	@Prop() autoFocus?: boolean = false;
	/** Sugerencia de teclado virtual en móvil (`numeric`, `email`, …). */
	@Prop() inputMode?: string;
	/** Patrón de validación HTML. */
	@Prop() pattern?: string;
	/** Mensaje de error inline; activa el estado inválido (borde danger + aria-invalid). */
	@Prop() error?: string;
	/** Marca el campo como inválido sin texto (borde danger + aria-invalid). */
	@Prop() invalid?: boolean = false;
	/** Mensaje de éxito inline (borde success). Se ignora si hay `error`. */
	@Prop() success?: string;
	/** Texto de ayuda neutro bajo el campo. Se ignora si hay `error`/`success`. */
	@Prop() hint?: string;

	private readonly uid = `adc-input-${inputUid++}`;

	componentDidLoad() {
		// `autofocus` nativo no dispara en elementos insertados por script: lo hacemos a mano.
		if (this.autoFocus) this.el.querySelector("input")?.focus();
	}

	private get isInvalid(): boolean {
		return this.invalid || !!this.error;
	}

	private get messageId(): string | undefined {
		if (!this.error && !this.success && !this.hint) return undefined;
		return `${this.inputId || this.name || this.uid}-msg`;
	}

	private borderClass(): string {
		if (this.isInvalid) return "border-danger";
		if (this.success) return "border-success";
		return "border-text/15";
	}

	private renderMessage(messageId: string | undefined) {
		if (this.error) {
			return (
				<span id={messageId} role="alert" class="mt-1 block font-text text-[11px] text-danger">
					{this.error}
				</span>
			);
		}
		if (this.success) {
			return (
				<span id={messageId} class="mt-1 block font-text text-[11px] text-success">
					{this.success}
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
				<input
					id={this.inputId}
					value={this.value}
					placeholder={this.placeholder}
					name={this.name}
					type={this.type}
					autocomplete={this.autocomplete}
					disabled={this.disabled}
					maxlength={this.maxLength}
					min={this.min}
					max={this.max}
					step={this.step}
					required={this.required}
					readonly={this.readOnly}
					inputmode={this.inputMode}
					pattern={this.pattern}
					aria-label={this.ariaLabel || this.placeholder || this.name}
					aria-invalid={this.isInvalid ? "true" : undefined}
					aria-describedby={messageId}
					class={`w-full px-3 py-2 rounded-xxl border bg-surface font-text text-[12px] text-text disabled:opacity-50 disabled:cursor-not-allowed ${this.borderClass()}`}
				/>
				{this.renderMessage(messageId)}
			</Host>
		);
	}
}
