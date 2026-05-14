import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-app-projects",
	styleUrl: "../../adc-icon.css",
	shadow: true,
})
export class AdcIconAppProjects {
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
					<rect x="3" y="3" width="7" height="7" rx="1" stroke-linejoin="round" />
					<rect x="14" y="3" width="7" height="7" rx="1" stroke-linejoin="round" />
					<rect x="3" y="14" width="7" height="7" rx="1" stroke-linejoin="round" />
					<rect x="14" y="14" width="7" height="7" rx="1" stroke-linejoin="round" />
				</svg>
			</Host>
		);
	}
}
