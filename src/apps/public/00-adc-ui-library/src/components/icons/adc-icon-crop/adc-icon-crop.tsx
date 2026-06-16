import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-crop",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconCrop {
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
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 2v14a2 2 0 0 0 2 2h14" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M18 22V8a2 2 0 0 0-2-2H2" />
				</svg>
			</Host>
		);
	}
}
