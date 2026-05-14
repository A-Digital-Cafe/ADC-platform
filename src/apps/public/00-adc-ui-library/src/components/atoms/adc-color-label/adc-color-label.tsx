import { Component, Prop } from "@stencil/core";

/**
 * Chip compacto con color de la paleta arcoíris de la plataforma.
 * El contenido se provee vía slot. La paleta se resuelve vía clase `.adc-label-<color>`
 * definida en el CSS global de la ui-library.
 */
@Component({
	tag: "adc-color-label",
	shadow: false,
})
export class AdcColorLabel {
	/** Nombre del color (debe existir en la paleta global ADC) */
	@Prop() color: string = "blue";

	/** Tamaño del chip */
	@Prop() size: "xs" | "sm" | "md" = "sm";

	/** Si es true, muestra un punto indicador antes del texto */
	@Prop() dot: boolean = false;

	/** Si es true, usa borde y fondo transparente (outline) */
	@Prop() outline: boolean = false;

	private readonly sizeClass = (size: string) => {
		switch (size) {
			case "xs":
				return "px-1.5 py-0 text-[10px]";
			case "md":
				return "px-2.5 py-1 text-sm";
			default:
				return "px-2 py-0.5 text-xs";
		}
	};

	render() {
		const sizeClass = this.sizeClass(this.size);
		const base = "flex items-center gap-1 rounded-full font-text font-medium";
		const variant = this.outline ? "bg-transparent border" : "";
		return (
			<span class={`${base} ${sizeClass} ${variant} adc-label-${this.color}`}>
				{this.dot && <span class="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "currentColor" }}></span>}
				<slot></slot>
			</span>
		);
	}
}
