import { Component, Prop, Event, EventEmitter, Host } from "@stencil/core";

/**
 * Selector de color (swatch nativo + hex editable). Atom reutilizable (lo usaba
 * el editor de imágenes como control local). Controlado: el consumidor pasa
 * `value` y escucha `adcChange` con el nuevo color (string).
 */
@Component({
	tag: "adc-color-picker",
	shadow: false,
})
export class AdcColorPicker {
	/** Etiqueta opcional a la izquierda del control. */
	@Prop() label?: string;
	/** Color actual (hex `#rrggbb` o cualquier CSS color para el campo de texto). */
	@Prop() value: string = "#ffffff";
	@Prop() disabled: boolean = false;

	@Event() adcChange!: EventEmitter<string>;

	private readonly emit = (event: Event) => {
		this.adcChange.emit((event.target as HTMLInputElement).value);
	};

	render() {
		const hex = this.value.startsWith("#") ? this.value : "#ffffff";
		return (
			<Host class="block">
				<label class="flex items-center justify-between gap-2 text-xs text-text opacity-90">
					{this.label && <span>{this.label}</span>}
					<span class="flex items-center gap-2">
						<input
							type="color"
							value={hex}
							disabled={this.disabled}
							onInput={this.emit}
							class="h-7 w-9 cursor-pointer rounded border border-surface bg-transparent p-0 disabled:opacity-40"
						/>
						<input
							type="text"
							value={this.value}
							disabled={this.disabled}
							onInput={this.emit}
							class="w-20 rounded border border-surface bg-transparent px-1 py-0.5 font-mono text-[11px]"
						/>
					</span>
				</label>
			</Host>
		);
	}
}
