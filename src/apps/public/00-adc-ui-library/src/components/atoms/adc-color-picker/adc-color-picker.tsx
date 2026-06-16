import { Component, Prop, State, Event, EventEmitter, Host } from "@stencil/core";

interface EyeDropperResult {
	sRGBHex: string;
}
type EyeDropperCtor = new () => { open(): Promise<EyeDropperResult> };

/** Canvas reutilizable para normalizar cualquier color CSS a `#rrggbb`. */
let parseCtx: CanvasRenderingContext2D | null = null;

/**
 * Normaliza cualquier color CSS (hex 3/6, `rgb()`, `rgba()`, nombre) a `#rrggbb`
 * para el input nativo `type=color` (que sólo acepta ese formato). Ante un valor
 * inválido devuelve negro (nunca `NaN` ni un color equivocado).
 */
function cssColorToHex(value: string): string {
	const v = (value || "").trim();
	if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
	if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
	if (typeof document === "undefined") return "#000000";
	if (!parseCtx) parseCtx = document.createElement("canvas").getContext("2d");
	if (!parseCtx) return "#000000";
	parseCtx.fillStyle = "#000000"; // baseline: si `v` es inválido, fillStyle no cambia
	parseCtx.fillStyle = v;
	const norm = parseCtx.fillStyle; // el navegador devuelve "#rrggbb" o "rgba(r, g, b, a)"
	if (/^#[0-9a-f]{6}$/i.test(norm)) return norm.toLowerCase();
	const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(norm);
	if (!m) return "#000000";
	const hx = (n: string) => Number(n).toString(16).padStart(2, "0");
	return `#${hx(m[1])}${hx(m[2])}${hx(m[3])}`;
}

/**
 * Selector de color (swatch nativo + campo de texto editable). Atom reutilizable
 * (lo usaba el editor de imágenes como control local). Controlado: el consumidor
 * pasa `value` y escucha `adcChange` con el nuevo color (string). El swatch nativo
 * muestra siempre el color normalizado a hex; el campo de texto admite el valor
 * completo (incl. `rgba(...)`).
 */
@Component({
	tag: "adc-color-picker",
	shadow: false,
})
export class AdcColorPicker {
	/** Etiqueta opcional sobre el control. */
	@Prop() label?: string;
	/** Color actual (hex `#rrggbb` o cualquier CSS color para el campo de texto). */
	@Prop() value: string = "#000000";
	@Prop() disabled: boolean = false;

	/** `true` si el navegador soporta la EyeDropper API (cuentagotas de pantalla). */
	@State() hasEyeDropper: boolean = false;

	@Event() adcChange!: EventEmitter<string>;

	componentWillLoad() {
		this.hasEyeDropper = typeof (globalThis as { EyeDropper?: EyeDropperCtor }).EyeDropper === "function";
	}

	/** Campo de texto: emite el valor crudo (admite `rgba(...)`, nombres, etc.). */
	private readonly emit = (event: Event) => {
		this.adcChange.emit((event.target as HTMLInputElement).value);
	};

	/** Swatch nativo `type=color`: normaliza a `#rrggbb` antes de emitir (algunos
	 * navegadores/entornos devuelven un `value` no estándar al elegir un color). */
	private readonly emitSwatch = (event: Event) => {
		this.adcChange.emit(cssColorToHex((event.target as HTMLInputElement).value));
	};

	/** Cuentagotas: muestrea un color de la pantalla y emite `#rrggbb` normalizado. */
	private readonly pickFromScreen = async () => {
		if (this.disabled) return;
		const Ctor = (globalThis as { EyeDropper?: EyeDropperCtor }).EyeDropper;
		if (!Ctor) return;
		try {
			const result = await new Ctor().open();
			this.adcChange.emit(cssColorToHex(String(result?.sRGBHex ?? "")));
		} catch {
			/* el usuario canceló (Escape) */
		}
	};

	render() {
		return (
			<Host class="block">
				<label class="flex flex-col gap-1 text-xs text-text opacity-90">
					{this.label && <span class="opacity-80">{this.label}</span>}
					<span class="flex items-center gap-2">
						<input
							type="color"
							value={cssColorToHex(this.value)}
							disabled={this.disabled}
							onInput={this.emitSwatch}
							class="h-7 w-9 shrink-0 cursor-pointer rounded border border-surface bg-transparent p-0 disabled:opacity-40"
						/>
						<input
							type="text"
							value={this.value}
							disabled={this.disabled}
							onInput={this.emit}
							class="min-w-0 flex-1 rounded border border-surface bg-transparent px-1 py-0.5 font-mono text-[11px]"
						/>
						{this.hasEyeDropper && (
							<button
								type="button"
								disabled={this.disabled}
								onClick={this.pickFromScreen}
								title="Seleccionar un color de la pantalla"
								aria-label="Seleccionar un color de la pantalla"
								class="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-surface text-text hover:bg-surface disabled:opacity-40"
							>
								<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="m2 22 1-1h3l9-9" />
									<path d="M3 21v-3l9-9" />
									<path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
								</svg>
							</button>
						)}
					</span>
				</label>
			</Host>
		);
	}
}
