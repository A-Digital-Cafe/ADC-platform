import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-app-help",
	styleUrl: "../../adc-icon.css",
	shadow: true,
})
export class AdcIconAppHelp {
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
						d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75m-.041 3.029v.008m9-5.296a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
					/>
				</svg>
			</Host>
		);
	}
}
