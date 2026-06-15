import { Component, Prop, Event, EventEmitter, Host } from "@stencil/core";

/**
 * Slider de rango con etiqueta y valor. Atom reutilizable (lo usaba el editor de
 * imágenes como control local). Controlado: el consumidor pasa `value` y escucha
 * `adcChange` con el nuevo número.
 */
@Component({
	tag: "adc-slider",
	shadow: false,
})
export class AdcSlider {
	/** Etiqueta opcional sobre el control. */
	@Prop() label?: string;
	@Prop() value: number = 0;
	@Prop() min: number = 0;
	@Prop() max: number = 100;
	@Prop() step: number = 1;
	/** Sufijo mostrado junto al valor (ej. `px`, `%`). */
	@Prop() unit?: string;
	@Prop() disabled: boolean = false;

	@Event() adcChange!: EventEmitter<number>;

	private readonly handleInput = (event: Event) => {
		const next = Number((event.target as HTMLInputElement).value);
		this.adcChange.emit(next);
	};

	render() {
		return (
			<Host class="block">
				<label class="flex flex-col gap-1 text-xs">
					{this.label && (
						<span class="flex justify-between text-text opacity-80">
							<span>{this.label}</span>
							<span class="tabular-nums opacity-60">
								{this.value}
								{this.unit ?? ""}
							</span>
						</span>
					)}
					<input
						type="range"
						min={this.min}
						max={this.max}
						step={this.step}
						value={this.value}
						disabled={this.disabled}
						onInput={this.handleInput}
						class="w-full accent-primary disabled:opacity-40"
					/>
				</label>
			</Host>
		);
	}
}
