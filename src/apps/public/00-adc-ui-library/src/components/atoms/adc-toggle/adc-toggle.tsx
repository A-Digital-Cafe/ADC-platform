import { Component, Prop, Event, EventEmitter } from "@stencil/core";

@Component({
	tag: "adc-toggle",
	shadow: false,
})
export class AdcToggle {
	/** Whether the toggle is checked */
	@Prop() checked: boolean = false;

	/** Whether the toggle is disabled */
	@Prop() disabled: boolean = false;

	/** Label text */
	@Prop() label?: string;

	/** Accessible name */
	@Prop() ariaLabel?: string;

	@Event() adcChange!: EventEmitter<boolean>;

	private readonly handleClick = () => {
		if (this.disabled) return;
		this.adcChange.emit(!this.checked);
	};

	private readonly handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			this.handleClick();
		}
	};

	render() {
		const trackClass = `relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
			this.checked ? "bg-primary" : "bg-surface"
		} ${this.disabled ? "opacity-40 cursor-not-allowed" : ""}`;

		const thumbClass = `inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
			this.checked ? "translate-x-6" : "translate-x-1"
		}`;

		return (
			<label class="inline-flex items-center gap-2 cursor-pointer select-none">
				<span
					class={trackClass}
					role="switch"
					aria-checked={this.checked ? "true" : "false"}
					aria-label={this.ariaLabel || this.label}
					aria-disabled={this.disabled ? "true" : undefined}
					tabindex={this.disabled ? -1 : 0}
					onClick={this.handleClick}
					onKeyDown={this.handleKeyDown}
				>
					<span class={thumbClass}></span>
				</span>
				{this.label && <span class="font-text text-sm text-text">{this.label}</span>}
			</label>
		);
	}
}
