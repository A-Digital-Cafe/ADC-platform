import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-no-avatar",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconNoAvatar {
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
					stroke-width="1.8"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="9.25" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.25 9.25a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0Z" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M7.5 18a5.2 5.2 0 0 1 9 0" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M5.75 18.25 18.25 5.75" />
				</svg>
			</Host>
		);
	}
}
