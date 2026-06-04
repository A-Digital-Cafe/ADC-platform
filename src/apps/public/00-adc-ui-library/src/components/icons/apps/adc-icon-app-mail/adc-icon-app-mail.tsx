import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-app-mail",
	styleUrl: "../../adc-icon.css",
	shadow: true,
})
export class AdcIconAppMail {
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
					<rect x="3" y="5" width="18" height="14" rx="2" stroke-linejoin="round" />
					<path d="m3.5 7 7.3 5.2a2 2 0 0 0 2.4 0L20.5 7" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</Host>
		);
	}
}
