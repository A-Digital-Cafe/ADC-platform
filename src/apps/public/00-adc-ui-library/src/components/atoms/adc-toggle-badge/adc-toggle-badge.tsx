import { Component, Prop, Event, EventEmitter, Element } from "@stencil/core";

@Component({
	tag: "adc-toggle-badge",
	shadow: false,
})
export class AdcToggleBadge {
	@Element() el!: HTMLElement;

	/** Whether the badge is in the active/selected state */
	@Prop() active: boolean = false;

	/** Emitted when tapped */
	@Event() adcToggle!: EventEmitter<void>;

	private readonly handleClick = () => {
		this.adcToggle.emit();
	};

	render() {
		const cls = this.active ? "bg-primary text-tprimary border-muted" : "bg-surface text-text border-muted hover:border-primary";

		const label = this.el.textContent?.trim() || "";

		return (
			<button
				type="button"
				aria-label={label}
				aria-pressed={this.active ? "true" : "false"}
				class={`px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${cls}`}
				onClick={this.handleClick}
			>
				<slot />
			</button>
		);
	}
}
