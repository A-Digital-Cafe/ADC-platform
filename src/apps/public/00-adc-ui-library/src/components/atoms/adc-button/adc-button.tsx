import { Component, Prop, Event, EventEmitter, Watch, Element, forceUpdate } from "@stencil/core";
@Component({
	tag: "adc-button",
	shadow: false,
})
export class AdcButton {
	@Element() el!: HTMLElement;

	@Prop() type: "button" | "submit" | "reset" = "button";
	@Prop() variant: "primary" | "accent" | "accent-outlined" | "danger" | "danger-outlined" = "primary";
	@Prop() size: "normal" | "small" = "normal";
	@Prop() disabled?: boolean;
	@Prop() href?: string;
	@Prop() ariaLabel?: string;
	/** Label text - when provided, takes precedence over slot content for dynamic updates */
	@Prop() label?: string;
	/** Muestra un spinner y deshabilita el botón mientras una acción está en curso. */
	@Prop() loading?: boolean;

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
		if (this.loading) return;
		this.adcClick.emit(event);
	};

	private renderSpinner() {
		return (
			<svg class="animate-spin h-4 w-4 inline-block align-[-2px] mr-2" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
				<path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
			</svg>
		);
	}

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
		else if (this.variant === "danger-outlined") variantClass = "border-2 border-danger bg-danger/70 text-tdanger hover:bg-danger/80";
		return `${this.baseClass} ${sizeClass} ${variantClass}`;
	}

	render() {
		const label = this.label ? this.label : <slot></slot>;
		const content = this.loading ? [this.renderSpinner(), label] : label;
		const className = `${this.getClass()}${this.loading ? " cursor-wait opacity-80" : ""}`;
		const isDisabled = this.disabled || this.loading;

		if (this.href) {
			return (
				<a
					href={this.href}
					target="_blank"
					rel="noopener noreferrer"
					class={className}
					aria-label={this.ariaLabel}
					aria-disabled={isDisabled}
					aria-busy={this.loading ? "true" : undefined}
					onClick={isDisabled ? undefined : this.handleClick}
				>
					{content}
				</a>
			);
		}

		return (
			<button
				type={this.type}
				class={className}
				aria-label={this.ariaLabel}
				aria-busy={this.loading ? "true" : undefined}
				disabled={isDisabled}
				onClick={this.handleClick}
			>
				{content}
			</button>
		);
	}
}
