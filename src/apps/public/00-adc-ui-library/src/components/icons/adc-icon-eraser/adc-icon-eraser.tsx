import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-eraser",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconEraser {
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
					<path stroke-linecap="round" stroke-linejoin="round" d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M22 21H7" />
					<path stroke-linecap="round" stroke-linejoin="round" d="m5 11 9 9" />
				</svg>
			</Host>
		);
	}
}
