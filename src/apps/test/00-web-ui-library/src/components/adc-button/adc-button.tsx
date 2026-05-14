import { Component, Prop, h, Event, EventEmitter, Host } from "@stencil/core";

/**
 * ADC Button - Componente de botón con Tailwind CSS
 *
 * Usa clases de Tailwind via CSS personalizado con @apply
 * para mantener el encapsulamiento del Shadow DOM
 */
@Component({
	tag: "adc-button",
	styleUrl: "adc-button.css",
	shadow: true,
})
export class AdcButton {
	@Prop() disabled: boolean = false;
	@Prop() ariaLabel: string | null = "generic-button";
	@Prop() buttonType: "button" | "submit" | "reset" = "button";
	@Prop() variant: "primary" | "secondary" | "success" | "warning" | "danger" = "primary";
	@Prop() size: "sm" | "md" | "lg" = "md";

	@Event() adcClick: EventEmitter<MouseEvent> | undefined;

	private readonly handleClick = (event: MouseEvent) => {
		if (!this.disabled) this.adcClick?.emit(event);
	};

	render() {
		const classes = {
			"adc-btn": true,
			[`adc-btn--${this.variant}`]: true,
			[`adc-btn--${this.size}`]: true,
			"adc-btn--disabled": this.disabled,
		};

		return (
			<Host>
				<button aria-label={this.ariaLabel} type={this.buttonType} onClick={this.handleClick} disabled={this.disabled} class={classes}>
					<slot></slot>
				</button>
			</Host>
		);
	}
}
