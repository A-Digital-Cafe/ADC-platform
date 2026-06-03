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

	/** Whether the checkbox is visually enabled even if disabled */
	@Prop() visualEnabled: boolean = false;

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
		const labelDisabledClass = this.disabled && !this.visualEnabled ? "opacity-40" : "";
		const cursorClass = this.disabled ? "cursor-not-allowed" : "cursor-pointer";

		return (
			<label class={`inline-flex items-center gap-1.5 select-none ${labelDisabledClass} ${cursorClass}`}>
				<input
					type="checkbox"
					checked={this.checked}
					disabled={this.disabled && !this.visualEnabled}
					onChange={this.handleChange}
					class={`w-4 h-4 accent-primary ${cursorClass}`}
					aria-label={this.ariaLabel || this.label}
				/>
				{this.label && <span class="font-text text-xs text-text">{this.label}</span>}
			</label>
		);
	}
}
