import { Component, Prop, Host } from "@stencil/core";

/**
 * Panel con efecto glassmorphism/blur
 * Ideal para formularios de auth, modales y tarjetas destacadas
 */
@Component({
	tag: "adc-blur-panel",
	styleUrl: "adc-blur-panel.css",
	shadow: true,
})
export class AdcBlurPanel {
	/**
	 * Intensidad del blur (sm, md, lg, xl)
	 */
	@Prop({ attribute: "blur" }) blurSize: "sm" | "md" | "lg" | "xl" = "lg";

	/**
	 * Padding interno (none, sm, md, lg, xl)
	 */
	@Prop() padding: "none" | "sm" | "md" | "lg" | "xl" = "lg";

	/**
	 * Radio de borde (sm, md, lg, xl, full)
	 */
	@Prop() radius: "sm" | "md" | "lg" | "xl" | "full" = "xl";

	/**
	 * Mostrar borde luminoso sutil
	 */
	@Prop() glow: boolean = false;

	/**
	 * Variante de estilo
	 * - default: fondo semi-transparente estándar
	 * - elevated: más opaco con sombra pronunciada
	 * - subtle: casi transparente, solo blur
	 */
	@Prop() variant: "default" | "elevated" | "subtle" = "default";

	render() {
		return (
			<Host
				class={{
					"blur-panel": true,
					[`blur-${this.blurSize}`]: true,
					[`padding-${this.padding}`]: true,
					[`radius-${this.radius}`]: true,
					[`variant-${this.variant}`]: true,
					"has-glow": this.glow,
				}}
			>
				<div class="panel-inner">
					<slot></slot>
				</div>
			</Host>
		);
	}
}
