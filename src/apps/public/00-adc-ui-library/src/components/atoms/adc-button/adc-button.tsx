import { Component, Prop, Event, EventEmitter, Watch, Element, forceUpdate } from "@stencil/core";
@Component({
	tag: "adc-button",
	shadow: false,
})
export class AdcButton {
	@Element() el!: HTMLElement;

	@Prop() type: "button" | "submit" | "reset" = "button";
	@Prop() variant: "primary" | "accent" | "accent-outlined" | "danger" = "primary";
	@Prop() size: "normal" | "small" = "normal";
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
		"rounded-3xl shadow-cozy font-heading cursor-pointer hover:brightness-105 inline-block text-center font-semibold touch-manipulation";

	private getClass(): string {
		const sizeClass = this.size === "small" ? "px-4 py-2 text-sm min-h-[36px] min-w-[36px]" : "px-8 py-4 min-h-[44px] min-w-[44px]";
		// border-2 (transparente en variantes rellenas) mantiene la misma caja que la
		// variante outlined, para que alineen pixel-perfect lado a lado (footers de modal).
		let variantClass = "border-2 border-transparent bg-primary text-tprimary";
		if (this.variant === "accent") variantClass = "border-2 border-transparent bg-accent text-tprimary";
		else if (this.variant === "danger") variantClass = "border-2 border-transparent bg-danger text-tdanger";
		else if (this.variant === "accent-outlined") variantClass = "border-2 border-accent/50 bg-transparent text-accent hover:bg-accent/10";
		return `${this.baseClass} ${sizeClass} ${variantClass}`;
	}

	render() {
		const content = this.label ? this.label : <slot></slot>;
		const className = this.getClass();

		if (this.href) {
			return (
				<a
					href={this.href}
					target="_blank"
					rel="noopener noreferrer"
					class={className}
					aria-label={this.ariaLabel}
					aria-disabled={this.disabled}
					onClick={this.disabled ? undefined : this.handleClick}
				>
					{content}
				</a>
			);
		}

		return (
			<button type={this.type} class={className} aria-label={this.ariaLabel} disabled={this.disabled} onClick={this.handleClick}>
				{content}
			</button>
		);
	}
}
