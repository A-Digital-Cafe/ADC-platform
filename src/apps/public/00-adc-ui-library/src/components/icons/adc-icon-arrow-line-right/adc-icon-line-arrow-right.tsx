import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-line-arrow-right",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconLineArrowRight {
	@Prop() size: string = "2rem";

	render() {
		return (
			<Host>
				<svg class="adc-icon" style={{ width: this.size, height: this.size }} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M9.4 16.6L8 15.2 13.2 10 8 4.8 9.4 3.4 15.9 10l-6.5 6.6z" />
				</svg>
			</Host>
		);
	}
}
