import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-restore",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconRestore {
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
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M3 3v6h6" />
					<path d="M3.51 9a9 9 0 1 0 2.13-3.36L3 9" />
				</svg>
			</Host>
		);
	}
}
