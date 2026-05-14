import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-apps",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconApps {
	@Prop() size: string = "1rem";

	render() {
		return (
			<Host>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
					<circle cx="6" cy="6" r="1.8" />
					<circle cx="12" cy="6" r="1.8" />
					<circle cx="18" cy="6" r="1.8" />
					<circle cx="6" cy="12" r="1.8" />
					<circle cx="12" cy="12" r="1.8" />
					<circle cx="18" cy="12" r="1.8" />
					<circle cx="6" cy="18" r="1.8" />
					<circle cx="12" cy="18" r="1.8" />
					<circle cx="18" cy="18" r="1.8" />
				</svg>
			</Host>
		);
	}
}
