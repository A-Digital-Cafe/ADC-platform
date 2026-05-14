import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-vip",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconVip {
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
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 10l4 3 5-8 5 8 4-3v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z" />
				</svg>
			</Host>
		);
	}
}
