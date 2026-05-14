import { Component, Prop, Event, EventEmitter, Element } from "@stencil/core";

@Component({
	tag: "adc-button-expand",
	shadow: false,
})
export class AdcButtonExpand {
	@Element() el!: HTMLElement;

	@Prop() isExpanded: boolean = false;
	@Prop() ariaLabel: string = "Expandir menú";
	@Prop() ariaControls?: string;

	@Event() adcExpandToggle!: EventEmitter<boolean>;

	private readonly handleClick = () => {
		this.adcExpandToggle.emit(!this.isExpanded);
	};

	private readonly baseClass =
		"relative left-[-15px] text-primary cursor-pointer hover:brightness-105 inline-flex items-center min-h-[60px] touch-manipulation transition-transform duration-300";

	render() {
		return (
			<button
				type="button"
				class={this.baseClass}
				aria-label={this.ariaLabel}
				aria-expanded={this.isExpanded}
				aria-controls={this.ariaControls}
				onClick={this.handleClick}
			>
				<adc-icon-line-arrow-right
					style={{
						transform: this.isExpanded ? "rotate(180deg)" : "rotate(0deg)",
						transition: "transform 0.1s ease",
					}}
					aria-hidden="true"
				></adc-icon-line-arrow-right>
			</button>
		);
	}
}
