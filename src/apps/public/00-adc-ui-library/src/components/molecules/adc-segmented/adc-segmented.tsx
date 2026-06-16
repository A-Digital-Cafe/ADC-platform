import { Component, Prop, Event, EventEmitter } from "@stencil/core";

export interface SegmentedItem {
	value: string;
	label: string;
	/** Tag de un icono de la UI library (ej: "adc-icon-cursor"). Si falta, se muestra el label. */
	icon?: string;
}

/**
 * Switch segmentado (toggle de una sola selección): todas las opciones dentro de
 * un borde primary global; la activa va con fondo primary. Pensado para mostrar
 * herramientas/modos como iconos. Emite `adcChange` con el `value` elegido.
 */
@Component({
	tag: "adc-segmented",
	shadow: false,
})
export class AdcSegmented {
	/** Opciones (array u objeto JSON serializado). */
	@Prop() items: SegmentedItem[] | string = [];
	/** Valor seleccionado. */
	@Prop() value: string = "";
	/** Alto de los segmentos: alineado con `adc-button` (`small` ≈ 36px). */
	@Prop() size: "small" | "normal" = "normal";

	@Event() adcChange!: EventEmitter<string>;

	private get parsed(): SegmentedItem[] {
		if (typeof this.items === "string") {
			try {
				return JSON.parse(this.items);
			} catch {
				return [];
			}
		}
		return this.items || [];
	}

	render() {
		const seg = this.size === "small" ? "h-9 w-9" : "h-11 w-11";
		const iconSize = this.size === "small" ? "1.2rem" : "1.4rem";
		return (
			<div class="inline-flex items-center gap-0.5 rounded-full border-2 border-primary p-0.5" role="group">
				{this.parsed.map((it) => {
					const active = it.value === this.value;
					const Icon = it.icon as unknown as string;
					return (
						<button
							type="button"
							title={it.label}
							aria-label={it.label}
							aria-pressed={active ? "true" : "false"}
							class={`inline-flex ${seg} cursor-pointer items-center justify-center rounded-full transition-colors ${
								active ? "bg-primary text-tprimary" : "text-text hover:bg-primary/10"
							}`}
							onClick={() => this.adcChange.emit(it.value)}
						>
							{it.icon ? <Icon size={iconSize} /> : <span class="text-xs font-semibold">{it.label}</span>}
						</button>
					);
				})}
			</div>
		);
	}
}
