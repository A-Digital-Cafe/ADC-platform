import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-app-community",
	styleUrl: "../../adc-icon.css",
	shadow: true,
})
export class AdcIconAppCommunity {
	@Prop() size: string = "1.75rem";

	render() {
		return (
			<Host>
				<svg
					class="adc-icon"
					style={{ width: this.size, height: this.size }}
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					aria-hidden="true"
				>
					<path d="M3 12l9-8 9 8" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
				</svg>
			</Host>
		);
	}
}
