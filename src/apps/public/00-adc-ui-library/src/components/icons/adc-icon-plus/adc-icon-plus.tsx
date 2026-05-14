import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-plus",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconPlus {
	@Prop() size: string = "1rem";

	render() {
		return (
			<Host>
				<svg
					class="adc-icon"
					style={{ width: this.size, height: this.size }}
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
				</svg>
			</Host>
		);
	}
}
