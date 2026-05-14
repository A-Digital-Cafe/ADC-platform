import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-community",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconCommunity {
	@Prop() size: string = "2rem";

	render() {
		return (
			<Host>
				<svg class="adc-icon" style={{ width: this.size, height: this.size }} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
				</svg>
			</Host>
		);
	}
}
