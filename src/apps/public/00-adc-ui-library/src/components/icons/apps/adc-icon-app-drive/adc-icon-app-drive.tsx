import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-app-drive",
	styleUrl: "../../adc-icon.css",
	shadow: true,
})
export class AdcIconAppDrive {
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
					<path d="M3 8.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9.5a2 2 0 0 0-2-2h-7.6l-1.8-2H5a2 2 0 0 0-2 2v1z" stroke-linejoin="round" />
					<path d="M3 12h18" stroke-linecap="round" />
				</svg>
			</Host>
		);
	}
}
