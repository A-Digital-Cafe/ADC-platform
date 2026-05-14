import { Component, Prop, Event, EventEmitter, Watch, Element, forceUpdate } from "@stencil/core";
@Component({
	tag: "adc-button",
	shadow: false,
})
export class AdcButton {
	@Element() el!: HTMLElement;

	@Prop() type: "button" | "submit" | "reset" = "button";
	@Prop() variant: "primary" | "accent" = "primary";
	@Prop() disabled?: boolean;
	@Prop() href?: string;
	@Prop() ariaLabel?: string;
	/** Label text - when provided, takes precedence over slot content for dynamic updates */
	@Prop() label?: string;

	@Event() adcClick!: EventEmitter<MouseEvent>;

	private slotObserver?: MutationObserver;

	@Watch("label")
	onLabelChange() {
		forceUpdate(this);
	}

	connectedCallback() {
		// Observe slot changes to force re-render when slot content changes from frameworks like React
		this.slotObserver = new MutationObserver(() => {
			forceUpdate(this);
		});
		this.slotObserver.observe(this.el, { childList: true, subtree: true, characterData: true });
	}

	disconnectedCallback() {
		this.slotObserver?.disconnect();
	}

	private readonly handleClick = (event: MouseEvent) => {
		this.adcClick.emit(event);
	};

	private readonly baseClass =
		"rounded-3xl px-8 py-4 bg-primary text-tprimary shadow-cozy font-heading cursor-pointer hover:brightness-105 inline-block text-center font-semibold min-h-[44px] min-w-[44px] touch-manipulation";

	render() {
		const content = this.label ? this.label : <slot></slot>;

		if (this.href) {
			return (
				<a
					href={this.href}
					target="_blank"
					rel="noopener noreferrer"
					class={this.baseClass}
					aria-label={this.ariaLabel}
					aria-disabled={this.disabled}
					onClick={this.disabled ? undefined : this.handleClick}
				>
					{content}
				</a>
			);
		}

		return (
			<button type={this.type} class={this.baseClass} aria-label={this.ariaLabel} disabled={this.disabled} onClick={this.handleClick}>
				{content}
			</button>
		);
	}
}
