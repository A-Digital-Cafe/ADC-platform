import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-app-org",
	styleUrl: "../../adc-icon.css",
	shadow: true,
})
export class AdcIconAppOrg {
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
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008V7.5Z"
					/>
				</svg>
			</Host>
		);
	}
}
