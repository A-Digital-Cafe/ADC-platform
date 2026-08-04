import { Component, Prop, Event, EventEmitter, State, Element } from "@stencil/core";
import { fixedAnchor } from "../../../utils/fixed-anchor";

export interface SelectOption {
	label: string;
	value: string;
}

/**
 * Caja del menú, calculada al abrir.
 *
 * El menú se posiciona `fixed` para que un contenedor con `overflow` (tablas, modales)
 * no lo recorte, y eso obliga a anclarlo a mano al disparador: sin `left/top/width`
 * un elemento fijo se estira contra el viewport y queda desalineado al scrollear.
 */
interface MenuBox {
	left: number;
	width: number;
	maxHeight: number;
	/** Se usa uno u otro según haya lugar abajo o haya que abrir hacia arriba. */
	top?: number;
	bottom?: number;
}

const GAP = 4;
const VIEWPORT_MARGIN = 8;
const MAX_MENU_HEIGHT = 320;
const MIN_MENU_HEIGHT = 140;

@Component({
	tag: "adc-select",
	shadow: false,
})
export class AdcSelect {
	@Prop() value: string = "";
	@Prop() options: SelectOption[] | string = [];
	@Prop() placeholder: string = "Seleccione";
	/** Mensaje de error inline; activa el estado inválido (borde danger + aria-invalid). */
	@Prop() error?: string;
	/** Marca el control como inválido sin texto. */
	@Prop() invalid?: boolean = false;

	/** Normalizes options prop — handles both array and JSON string */
	private get parsedOptions(): SelectOption[] {
		if (typeof this.options === "string") {
			try {
				return JSON.parse(this.options);
			} catch {
				return [];
			}
		}
		return this.options || [];
	}

	@State() isOpen: boolean = false;
	@State() menu: MenuBox | null = null;

	@Element() el!: HTMLElement;

	@Event() adcChange!: EventEmitter<string>;

	private trigger?: HTMLButtonElement;

	disconnectedCallback() {
		this.unbind();
	}

	private readonly close = () => {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.unbind();
	};

	// El menú vive dentro del host aunque sea `fixed`: `contains` alcanza para distinguir
	// un clic en una opción de uno afuera.
	private readonly onOutsidePointer = (event: Event) => {
		if (!this.el.contains(event.target as Node)) this.close();
	};

	/** Scroll o resize despegan un menú fijo del disparador: se cierra en vez de flotar suelto. */
	private readonly onReflow = () => this.close();

	private bind() {
		document.addEventListener("pointerdown", this.onOutsidePointer, true);
		window.addEventListener("resize", this.onReflow);
		window.addEventListener("scroll", this.onReflow, true);
	}

	private unbind() {
		document.removeEventListener("pointerdown", this.onOutsidePointer, true);
		window.removeEventListener("resize", this.onReflow);
		window.removeEventListener("scroll", this.onReflow, true);
	}

	/** Ancla el menú al disparador, abriendo hacia arriba si abajo no entra. */
	private measure(): MenuBox {
		const rect = (this.trigger ?? this.el).getBoundingClientRect();
		// El espacio disponible se mide siempre contra el viewport (es lo que el usuario ve);
		// sólo las coordenadas se expresan en el sistema del bloque contenedor.
		const below = window.innerHeight - rect.bottom - GAP - VIEWPORT_MARGIN;
		const above = rect.top - GAP - VIEWPORT_MARGIN;
		const openUp = below < MIN_MENU_HEIGHT && above > below;
		const available = openUp ? above : below;
		const maxHeight = Math.max(MIN_MENU_HEIGHT, Math.min(MAX_MENU_HEIGHT, available));
		const cb = fixedAnchor(this.trigger ?? this.el);
		return {
			left: rect.left - cb.left,
			width: rect.width,
			maxHeight,
			...(openUp ? { bottom: cb.bottom - rect.top + GAP } : { top: rect.bottom + GAP - cb.top }),
		};
	}

	private readonly handleToggle = () => {
		if (this.isOpen) {
			this.close();
			return;
		}
		this.menu = this.measure();
		this.isOpen = true;
		this.bind();
	};

	private readonly handleSelect = (option: SelectOption) => {
		this.adcChange.emit(option.value);
		// Sync hidden native select and fire a native change event so React's onChange works
		const nativeSelect = this.el.querySelector<HTMLSelectElement>("select[data-adc-hidden]");
		if (nativeSelect) {
			nativeSelect.value = option.value;
			nativeSelect.dispatchEvent(new globalThis.Event("change", { bubbles: true }));
		}
		this.close();
	};

	private readonly handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			this.close();
			this.trigger?.focus();
		}
	};

	private readonly getSelectedLabel = (): string => {
		const selected = this.parsedOptions.find((opt) => opt.value === this.value);
		return selected ? selected.label : this.placeholder;
	};

	private menuStyle(): Record<string, string> {
		const box = this.menu;
		if (!box) return {};
		return {
			left: `${box.left}px`,
			width: `${box.width}px`,
			maxHeight: `${box.maxHeight}px`,
			...(box.top === undefined ? {} : { top: `${box.top}px` }),
			...(box.bottom === undefined ? {} : { bottom: `${box.bottom}px` }),
		};
	}

	render() {
		const isInvalid = this.invalid || !!this.error;
		const selectedLabel = this.getSelectedLabel();
		return (
			<div class="relative w-full" onKeyDown={this.handleKeyDown}>
				{/* Hidden native select — enables React onChange to work */}
				<select data-adc-hidden aria-hidden="true" tabindex={-1} style={{ display: "none" }}>
					{this.parsedOptions.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>
				<button
					type="button"
					ref={(el) => (this.trigger = el as HTMLButtonElement)}
					class={`w-full px-3 py-2 rounded-xxl border bg-surface text-text text-[12px] font-text flex justify-between items-center gap-2 ${isInvalid ? "border-danger" : "border-text/15"}`}
					aria-haspopup="menu"
					aria-expanded={this.isOpen ? "true" : "false"}
					aria-invalid={isInvalid ? "true" : null}
					title={selectedLabel}
					onClick={this.handleToggle}
				>
					<span class="truncate text-left">{selectedLabel}</span>
					<svg class="h-3.5 w-3.5 shrink-0 text-text" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.08 1.04l-4.25 4.25a.75.75 0 0 1-1.06 0L5.25 8.27a.75.75 0 0 1-.02-1.06Z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
				{this.isOpen && (
					<div
						class="fixed z-50 bg-background border border-text/15 rounded-xxl shadow-cozy overflow-y-auto py-1"
						style={this.menuStyle()}
						role="menu"
					>
						{this.parsedOptions.map((option) => (
							<button
								type="button"
								class="px-3 py-1.5 cursor-pointer hover:bg-text/10 text-text w-full text-left text-[12px] font-text truncate"
								role="menuitem"
								title={option.label}
								key={`select-${option.value}`}
								onClick={() => this.handleSelect(option)}
							>
								{option.label}
							</button>
						))}
					</div>
				)}
				{this.error && (
					<span role="alert" class="mt-1 block font-text text-[11px] text-danger">
						{this.error}
					</span>
				)}
			</div>
		);
	}
}
