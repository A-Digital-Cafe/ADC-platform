import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-app-identity",
	styleUrl: "../../adc-icon.css",
	shadow: true,
})
export class AdcIconAppIdentity {
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
					<path d="M12 2l8 4v6c0 5.25-3.5 8.75-8 10-4.5-1.25-8-4.75-8-10V6l8-4z" stroke-linejoin="round" />
					<circle cx="12" cy="10" r="2.5" />
					<path d="M8.5 16.5c0-2 1.5-3 3.5-3s3.5 1 3.5 3" stroke-linecap="round" />
				</svg>
			</Host>
		);
	}
}
