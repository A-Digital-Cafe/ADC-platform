import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-dots-vertical",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconDotsVertical {
	@Prop() size: string = "1rem";

	render() {
		return (
			<Host>
				<svg
					class="adc-icon"
					style={{ width: this.size, height: this.size }}
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="currentColor"
					aria-hidden="true"
				>
					<circle cx="12" cy="5" r="1.6" />
					<circle cx="12" cy="12" r="1.6" />
					<circle cx="12" cy="19" r="1.6" />
				</svg>
			</Host>
		);
	}
}
