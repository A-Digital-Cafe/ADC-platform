import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-app-image-editor",
	styleUrl: "../../adc-icon.css",
	shadow: true,
})
export class AdcIconAppImageEditor {
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
					<rect x="3" y="4" width="18" height="16" rx="2" stroke-linejoin="round" />
					<circle cx="8.5" cy="9.5" r="1.5" />
					<path d="m4 16 5-5 3.5 3.5L16 11l4 5" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</Host>
		);
	}
}
