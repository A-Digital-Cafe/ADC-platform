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

	/** Whether the toggle looks active even if disabled (canal obligatorio) */
	@Prop() visualEnabled: boolean = false;

	/** Label text */
	@Prop() label?: string;

	/** Accessible name */
	@Prop() ariaLabel?: string;

	/** Native tooltip (title attribute) */
	@Prop() hint?: string;

	/** Visual size */
	@Prop() size: "normal" | "small" = "normal";

	/** Id of the inner input, so an outer label can target it */
	@Prop() inputId?: string;

	/** aria-describedby of the inner input */
	@Prop() describedBy?: string;

	@Event() adcChange!: EventEmitter<boolean>;

	private readonly handleChange = (event: Event) => {
		// visualEnabled deja el input operable a propósito; sin revertir, el estado nativo se desincroniza del prop.
		if (this.disabled) {
			(event.target as HTMLInputElement).checked = this.checked;
			return;
		}
		this.adcChange.emit(!this.checked);
	};

	render() {
		const small = this.size === "small";
		const dimmed = this.disabled && !this.visualEnabled;
		const cursorClass = this.disabled ? "cursor-not-allowed" : "cursor-pointer";

		const trackClass = `relative inline-flex ${small ? "h-5 w-9" : "h-6 w-11"} items-center rounded-full transition-colors ${
			this.checked ? "bg-primary" : "bg-text/25"
		} peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background`;

		const thumbClass = `inline-block ${small ? "h-3 w-3" : "h-4 w-4"} rounded-full bg-white shadow-sm transition-transform ${
			this.checked ? (small ? "translate-x-5" : "translate-x-6") : "translate-x-1"
		}`;

		return (
			<label class={`inline-flex items-center gap-2 select-none ${cursorClass} ${dimmed ? "opacity-40" : ""}`} title={this.hint}>
				<input
					type="checkbox"
					role="switch"
					class="sr-only peer"
					id={this.inputId}
					checked={this.checked}
					disabled={this.disabled && !this.visualEnabled}
					aria-label={this.ariaLabel || this.label}
					aria-describedby={this.describedBy}
					aria-disabled={this.disabled ? "true" : undefined}
					onChange={this.handleChange}
				/>
				<span class={trackClass} aria-hidden="true">
					<span class={thumbClass}></span>
				</span>
				{this.label && <span class={`font-text ${small ? "text-xs" : "text-sm"} text-text`}>{this.label}</span>}
			</label>
		);
	}
}
