import { Component, Prop, State, Event, EventEmitter, Element, Listen, Watch } from "@stencil/core";
import { sanitizeSvg } from "../../../../utils/sanitize-svg.js";

export interface ContextMenuItem {
	label: string;
	/** Identificador emitido en `adcContextMenuSelect` al elegir el item. */
	action?: string;
	danger?: boolean;
	iconSvg?: string;
	/** Submenú anidado (un nivel); el item padre no emite selección propia. */
	children?: ContextMenuItem[];
}

/**
 * Menú contextual posicionado en coordenadas de viewport (click derecho o botón
 * "⋮"). Los items se pasan por la prop `items` (no por slots): así el componente
 * los renderiza internamente y se evita el error `removeChild` que aparece al
 * cambiar children slotteados de un componente Stencil `shadow: false` desde React.
 *
 * Uso (React):
 * ```jsx
 * <adc-context-menu open={m.open} x={m.x} y={m.y} items={items}
 *   onadcContextMenuSelect={(e) => run(e.detail.action)}
 *   onadcContextMenuClose={() => close()} />
 * ```
 * `items` admite `children` para un submenú (ej: Nuevo documento ▸ .md / .txt).
 */
@Component({
	tag: "adc-context-menu",
	shadow: false,
})
export class AdcContextMenu {
	@Prop({ mutable: true, reflect: true }) open: boolean = false;
	/** Coordenadas de viewport donde abrir el menú (ej: `event.clientX/Y`). */
	@Prop() x: number = 0;
	@Prop() y: number = 0;
	@Prop() items: ContextMenuItem[] = [];

	/** Índice del item de nivel superior cuyo submenú está abierto. */
	@State() openSubmenu: number | null = null;
	/** Abrir submenús hacia la izquierda cuando el panel queda pegado al borde derecho. */
	@State() flipSubmenu: boolean = false;

	@Element() el!: HTMLElement;

	@Event() adcContextMenuSelect!: EventEmitter<{ action: string; label: string }>;
	@Event() adcContextMenuClose!: EventEmitter<void>;

	private panelEl: HTMLDivElement | null = null;

	@Watch("open")
	onOpenChange() {
		if (!this.open) this.openSubmenu = null;
	}

	// Reposiciona tras cada render (sincrónico, antes del paint → sin flicker) para
	// clampear el panel dentro del viewport en los extremos de la pantalla.
	componentDidRender() {
		if (this.open) this.reposition();
	}

	// Cierre al hacer click afuera. Usamos `mousedown` (no `contextmenu`): el click
	// derecho dispara mousedown ANTES que contextmenu, así que cuando el consumidor
	// abre el menú en su handler de `contextmenu`, este listener ya pasó con `open`
	// aún en false y no lo cierra en el mismo gesto.
	@Listen("mousedown", { target: "document" })
	handleDocumentMouseDown(event: MouseEvent) {
		if (!this.open) return;
		if (this.el.contains(event.target as Node)) return;
		this.close();
	}

	@Listen("keydown", { target: "document" })
	handleDocumentKeyDown(event: KeyboardEvent) {
		if (this.open && event.key === "Escape") this.close();
	}

	private close() {
		this.open = false;
		this.adcContextMenuClose.emit();
	}

	private readonly select = (item: ContextMenuItem) => {
		if (item.children?.length) return;
		this.adcContextMenuSelect.emit({ action: item.action ?? "", label: item.label });
		this.close();
	};

	/** Clampa el panel al viewport para que no se corte en los bordes. */
	private reposition() {
		const panel = this.panelEl;
		if (!panel) return;
		const { offsetWidth, offsetHeight } = panel;
		const left = Math.max(4, Math.min(this.x, window.innerWidth - offsetWidth - 4));
		const top = Math.max(4, Math.min(this.y, window.innerHeight - offsetHeight - 4));
		panel.style.left = `${left}px`;
		panel.style.top = `${top}px`;
		// Si no hay lugar a la derecha para un submenú (~12rem), abrirlo hacia la izquierda.
		const flip = left + offsetWidth + 192 > window.innerWidth;
		if (flip !== this.flipSubmenu) this.flipSubmenu = flip;
	}

	private renderItem(item: ContextMenuItem, index: number, inSubmenu: boolean) {
		const children = item.children ?? [];
		const hasSubmenu = children.length > 0;
		const expanded = this.openSubmenu === index;
		const tone = item.danger ? "text-danger hover:bg-danger hover:text-tdanger" : "text-text hover:bg-primary hover:text-tprimary";
		const submenuSide = this.flipSubmenu ? "right-full mr-1" : "left-full ml-1";
		return (
			<div
				class="relative"
				role="none"
				onMouseEnter={() => !inSubmenu && hasSubmenu && (this.openSubmenu = index)}
				onMouseLeave={() => !inSubmenu && hasSubmenu && expanded && (this.openSubmenu = null)}
			>
				<button
					type="button"
					role="menuitem"
					aria-haspopup={hasSubmenu ? "menu" : undefined}
					aria-expanded={hasSubmenu ? String(expanded) : undefined}
					class={`flex w-full items-center gap-2 px-3 py-2 mx-1 rounded-md text-left text-sm whitespace-nowrap cursor-pointer transition-colors ${tone}`}
					onClick={() => this.select(item)}
				>
					{item.iconSvg && (
						<span class="flex items-center justify-center shrink-0 w-4 h-4" innerHTML={sanitizeSvg(item.iconSvg)}></span>
					)}
					<span class="flex-1">{item.label}</span>
					{hasSubmenu && (
						<svg class="w-3 h-3 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
						</svg>
					)}
				</button>

				{hasSubmenu && (
					<div
						class={`absolute top-0 ${submenuSide} min-w-44 py-1 rounded-xl border border-surface bg-background/95 backdrop-blur-sm shadow-cozy text-text ${expanded ? "block" : "hidden"}`}
						role="menu"
					>
						{children.map((child, i) => this.renderItem(child, i, true))}
					</div>
				)}
			</div>
		);
	}

	render() {
		return (
			<div
				ref={(node) => (this.panelEl = node ?? null)}
				class={`fixed z-100 min-w-52 py-1 rounded-xl border border-surface bg-background/95 backdrop-blur-sm shadow-cozy text-text ${
					this.open ? "visible opacity-100" : "invisible opacity-0 pointer-events-none"
				}`}
				role="menu"
				aria-hidden={this.open ? "false" : "true"}
			>
				{this.items.map((item, index) => this.renderItem(item, index, false))}
			</div>
		);
	}
}
