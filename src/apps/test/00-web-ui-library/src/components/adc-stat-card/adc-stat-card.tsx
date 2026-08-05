import { Component, Prop, Host } from "@stencil/core";

/**
 * ADC Stat Card - Componente de tarjeta de estadísticas con Tailwind CSS
 * 
 * Usa clases de Tailwind via CSS personalizado con @apply
 */
@Component({
	tag: "adc-stat-card",
	styleUrl: "adc-stat-card.css",
	shadow: true,
})
export class AdcStatCard {
	@Prop() cardTitle!: string;
	@Prop() value!: string | number;
	@Prop() description?: string;
	@Prop() color: "primary" | "success" | "warning" | "danger" | "default" = "primary";

	render() {
		return (
			<Host>
				<div class="stat-card">
					<h3 class={`stat-value stat-value--${this.color}`}>
						{this.value}
					</h3>
					<p class="stat-title">{this.cardTitle}</p>
					{this.description && (
						<p class="stat-description">{this.description}</p>
					)}
				</div>
			</Host>
		);
	}
}
