import { Component, Prop, Host } from "@stencil/core";

/** Icono de Sumi: un globo de diálogo con una chispa (el chatbot). */
@Component({
	tag: "adc-icon-app-sumi",
	styleUrl: "../../adc-icon.css",
	shadow: true,
})
export class AdcIconAppSumi {
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
						d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.4c-.5.4-1.3 0-1.3-.6V16A2.5 2.5 0 0 1 4 13.5Z"
						stroke-linejoin="round"
					/>
					<path
						d="M12 6.5c.5 1.4 1.4 2.3 2.8 2.8-1.4.5-2.3 1.4-2.8 2.8-.5-1.4-1.4-2.3-2.8-2.8 1.4-.5 2.3-1.4 2.8-2.8Z"
						stroke-linejoin="round"
					/>
				</svg>
			</Host>
		);
	}
}
