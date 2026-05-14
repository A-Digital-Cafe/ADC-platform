import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-left-arrow",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconLeftArrow {
	@Prop() size: string = "1rem";

	render() {
		return (
			<Host>
				<svg
					class="adc-icon"
					style={{ width: this.size, height: this.size }}
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 448 512"
					aria-hidden="true"
				>
					<path
						fill="currentColor"
						d="M257.5 445.1c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0l-192-192c-12.5-12.5-12.5-32.8 0-45.3l192-192c12.5-12.5 32.8-12.5 45.3 0s12.5 32.8 0 45.3L141.2 224H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H141.2l116.3 125.1z"
					/>
				</svg>
			</Host>
		);
	}
}
