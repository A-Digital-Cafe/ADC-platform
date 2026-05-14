import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-pencil",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconPencil {
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
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M16.862 4.487l1.651-1.651a2.25 2.25 0 113.182 3.182L6.75 21.964l-4.5 1.5 1.5-4.5L16.862 4.487z"
					/>
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 6l3 3" />
				</svg>
			</Host>
		);
	}
}
