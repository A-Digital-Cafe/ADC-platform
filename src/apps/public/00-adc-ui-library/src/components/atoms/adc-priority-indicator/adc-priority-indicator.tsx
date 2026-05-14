import { Component, Prop } from "@stencil/core";

/**
 * Indicador visual compacto de prioridad (urgencia + importancia + dificultad).
 * `urgency` y `importance` son 0..4. `difficulty` es 1..5 (o null = sin estimar).
 *
 * Renderiza tres mini barras apiladas horizontalmente con los colores semánticos
 * de la plataforma (warn/danger para alta, info/success para media/baja, muted
 * para none). Cada barra expone un tooltip nativo con el nombre completo.
 */
@Component({
	tag: "adc-priority-indicator",
	shadow: false,
})
export class AdcPriorityIndicator {
	@Prop() urgency: number = 0;
	@Prop() importance: number = 0;
	/** `null` o 0 = sin estimar */
	@Prop() difficulty: number | null = null;

	/** Muestra labels cortas debajo de cada barra */
	@Prop() showLabels: boolean = false;

	/** Etiquetas para los tooltips (i18n-friendly). */
	@Prop() urgencyLabel: string = "Urgency";
	@Prop() importanceLabel: string = "Importance";
	@Prop() difficultyLabel: string = "Difficulty";

	private toneFor(value: number, max: number): string {
		if (value <= 0) return "bg-muted/40";
		const ratio = value / max;
		if (ratio >= 0.8) return "bg-tdanger";
		if (ratio >= 0.6) return "bg-twarn";
		if (ratio >= 0.4) return "bg-tinfo";
		return "bg-tsuccess";
	}

	private renderBar(value: number, max: number, shortLabel: string, fullLabel: string) {
		const pct = Math.max(0, Math.min(1, value / max));
		const tone = this.toneFor(value, max);
		const tooltip = `${fullLabel}: ${value}/${max}`;
		return (
			<div class="flex flex-col items-center gap-0.5" title={tooltip} aria-label={tooltip}>
				<div class="w-8 h-1.5 rounded-full bg-muted/20 overflow-hidden">
					<div class={`h-full ${tone}`} style={{ width: `${pct * 100}%` }}></div>
				</div>
				{this.showLabels && <span class="text-[9px] text-muted uppercase tracking-wide">{shortLabel}</span>}
			</div>
		);
	}

	render() {
		const difficulty = this.difficulty ?? 0;
		return (
			<div class="inline-flex items-center gap-1.5">
				{this.renderBar(this.urgency, 4, "U", this.urgencyLabel)}
				{this.renderBar(this.importance, 4, "I", this.importanceLabel)}
				{this.renderBar(difficulty, 5, "D", this.difficultyLabel)}
			</div>
		);
	}
}
