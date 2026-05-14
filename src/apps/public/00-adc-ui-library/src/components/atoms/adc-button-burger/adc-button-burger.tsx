import { Component, Prop, Event, EventEmitter } from "@stencil/core";

@Component({
	tag: "adc-button-burger",
	shadow: false,
})
export class AdcBurgerButton {
	@Prop() isOpen: boolean = false;
	@Prop() ariaLabel: string = "Toggle menu";

	@Event() adcBurgerToggle!: EventEmitter<boolean>;

	private readonly handleClick = () => {
		this.adcBurgerToggle.emit(!this.isOpen);
	};

	render() {
		return (
			<button
				type="button"
				class="p-2 hover:bg-accent rounded transition-colors"
				onClick={this.handleClick}
				aria-label={this.ariaLabel}
				aria-expanded={this.isOpen}
			>
				<span class={`transition-transform duration-300 inline-block ${this.isOpen ? "rotate-90" : ""}`}>☰</span>
			</button>
		);
	}
}
