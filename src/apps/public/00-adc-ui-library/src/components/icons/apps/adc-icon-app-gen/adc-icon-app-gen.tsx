import { Component, Prop, Host } from "@stencil/core";

/** Icono de la app de generadores (`gen`): una "A" y un cuentagotas sobre una hoja. */
@Component({
	tag: "adc-icon-app-gen",
	styleUrl: "../../adc-icon.css",
	shadow: true,
})
export class AdcIconAppGen {
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
					<rect x="3" y="3" width="18" height="18" rx="3" stroke-linejoin="round" />
					<path d="M6.5 15.5 9.5 8l3 7.5" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M7.6 13.2h3.8" stroke-linecap="round" />
					<path d="M18 8.2a2.2 2.2 0 0 1 0 3.1l-2.6 2.6-1.6-1.6 2.6-2.6a2.2 2.2 0 0 1 1.6-1.5Z" stroke-linejoin="round" />
					<path d="M14.6 16.4h-1.2" stroke-linecap="round" />
				</svg>
			</Host>
		);
	}
}
