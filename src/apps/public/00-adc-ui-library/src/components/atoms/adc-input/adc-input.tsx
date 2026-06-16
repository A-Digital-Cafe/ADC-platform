import { Component, Prop, Element } from "@stencil/core";

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

	componentDidLoad() {
		// `autofocus` nativo no dispara en elementos insertados por script: lo hacemos a mano.
		if (this.autoFocus) this.el.querySelector("input")?.focus();
	}

	render() {
		return (
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
				class="w-full px-3 py-2 rounded-xxl border border-text/15 bg-surface font-text text-[12px] text-text disabled:opacity-50 disabled:cursor-not-allowed"
			/>
		);
	}
}
