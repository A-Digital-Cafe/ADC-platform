import { Component, Prop, Event, EventEmitter } from "@stencil/core";

@Component({
	tag: "adc-checkbox",
	shadow: false,
})
export class AdcCheckbox {
	/** Whether the checkbox is checked */
	@Prop() checked: boolean = false;

	/** Whether the checkbox is disabled */
	@Prop() disabled: boolean = false;

	/** Label text */
	@Prop() label?: string;

	/** Accessible name */
	@Prop() ariaLabel?: string;

	@Event() adcChange!: EventEmitter<boolean>;

	private readonly handleChange = () => {
		if (this.disabled) return;
		this.adcChange.emit(!this.checked);
	};

	render() {
		return (
			<label class={`inline-flex items-center gap-1.5 select-none ${this.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
				<input
					type="checkbox"
					checked={this.checked}
					disabled={this.disabled}
					onChange={this.handleChange}
					class="w-4 h-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
					aria-label={this.ariaLabel || this.label}
				/>
				{this.label && <span class="font-text text-xs text-text">{this.label}</span>}
			</label>
		);
	}
}
