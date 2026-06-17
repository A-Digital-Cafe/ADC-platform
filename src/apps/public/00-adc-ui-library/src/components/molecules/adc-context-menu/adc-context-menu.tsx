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
	/** Controlado por el consumidor: el componente NO lo auto-muta (evita el desync
	 * con React 19, que no re-empuja la prop si su valor no cambió). */
	@Prop({ reflect: true }) open: boolean = false;
	/** Coordenadas de viewport donde abrir el menú (ej: `event.clientX/Y`). */
	@Prop() x: number = 0;
	@Prop() y: number = 0;
	@Prop() items: ContextMenuItem[] = [];

	/** Visibilidad efectiva (derivada de `open` y de los gestos de cierre internos). */
	@State() visible: boolean = false;
	/** Índice del item de nivel superior cuyo submenú está abierto. */
	@State() openSubmenu: number | null = null;
	/** Abrir submenús hacia la izquierda cuando el panel queda pegado al borde derecho. */
	@State() flipSubmenu: boolean = false;

	@Element() el!: HTMLElement;

	@Event() adcContextMenuSelect!: EventEmitter<{ action: string; label: string }>;
	@Event() adcContextMenuClose!: EventEmitter<void>;

	private panelEl: HTMLDivElement | null = null;
	private submenuTimeout?: ReturnType<typeof setTimeout>;

	/** Margen mínimo al borde del viewport. */
	private static readonly MARGIN = 4;
	/** Gracia (ms) antes de cerrar el submenú al salir del item: permite cruzar el
	 * hueco entre el item y su submenú con el cursor sin que se cierre. */
	private static readonly SUBMENU_CLOSE_DELAY = 260;

	componentWillLoad() {
		this.visible = this.open;
	}

	/** Abre el submenú `index` de inmediato y cancela un cierre pendiente. */
	private readonly openSub = (index: number) => {
		if (this.submenuTimeout) {
			clearTimeout(this.submenuTimeout);
			this.submenuTimeout = undefined;
		}
		this.openSubmenu = index;
	};

	/** Cierra el submenú tras un breve delay (cancelable si el cursor vuelve). */
	private readonly scheduleCloseSub = () => {
		if (this.submenuTimeout) clearTimeout(this.submenuTimeout);
		this.submenuTimeout = setTimeout(() => {
			this.openSubmenu = null;
			this.submenuTimeout = undefined;
		}, AdcContextMenu.SUBMENU_CLOSE_DELAY);
	};

	@Watch("open")
	onOpenChange() {
		this.visible = this.open;
		if (!this.open) this.openSubmenu = null;
	}

	// React 19 puede no re-empujar `open` si su valor no cambió entre renders (ej:
	// abrir el menú en otra posición con un nuevo click derecho). Al cambiar las
	// coordenadas reabrimos, evitando el desync "abre y deja de funcionar".
	@Watch("x")
	@Watch("y")
	onCoordsChange() {
		if (this.open) this.visible = true;
	}

	// Un menú contextual está anclado a un punto del documento (click derecho / botón
	// "⋮"), no a un elemento que pueda seguir. Al scrollear lo cerramos (comportamiento
	// estándar) en vez de dejarlo flotando fijo; en resize sólo reclampeamos.
	private readonly handleScroll = () => {
		if (this.visible) this.close();
	};
	private readonly handleResize = () => {
		if (this.visible) this.reposition();
	};

	@Watch("visible")
	onVisibleChange(visible: boolean) {
		if (visible) {
			window.addEventListener("scroll", this.handleScroll, true);
			window.addEventListener("resize", this.handleResize);
		} else {
			this.removeViewportListeners();
			if (this.submenuTimeout) {
				clearTimeout(this.submenuTimeout);
				this.submenuTimeout = undefined;
			}
		}
	}

	private removeViewportListeners() {
		window.removeEventListener("scroll", this.handleScroll, true);
		window.removeEventListener("resize", this.handleResize);
	}

	disconnectedCallback() {
		this.removeViewportListeners();
		if (this.submenuTimeout) clearTimeout(this.submenuTimeout);
	}

	// Reposiciona tras cada render (sincrónico, antes del paint → sin flicker) para
	// clampear el panel dentro del viewport en los extremos de la pantalla.
	componentDidRender() {
		if (this.visible) this.reposition();
	}

	// Cierre al hacer click afuera. Usamos `mousedown` (no `contextmenu`): el click
	// derecho dispara mousedown ANTES que contextmenu, así que cuando el consumidor
	// abre el menú en su handler de `contextmenu`, este listener ya pasó con `open`
	// aún en false y no lo cierra en el mismo gesto.
	@Listen("mousedown", { target: "document" })
	handleDocumentMouseDown(event: MouseEvent) {
		if (!this.visible) return;
		if (this.el.contains(event.target as Node)) return;
		this.close();
	}

	@Listen("keydown", { target: "document" })
	handleDocumentKeyDown(event: KeyboardEvent) {
		if (this.visible && event.key === "Escape") this.close();
	}

	private close() {
		this.visible = false;
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
		const m = AdcContextMenu.MARGIN;
		const { offsetWidth, offsetHeight } = panel;
		const left = Math.max(m, Math.min(this.x, window.innerWidth - offsetWidth - m));
		const top = Math.max(m, Math.min(this.y, window.innerHeight - offsetHeight - m));
		panel.style.left = `${left}px`;
		panel.style.top = `${top}px`;
		// Si no hay lugar a la derecha para un submenú (~12rem), abrirlo hacia la izquierda.
		const flip = left + offsetWidth + 192 > window.innerWidth;
		if (flip !== this.flipSubmenu) this.flipSubmenu = flip;
		this.clampSubmenuVertical(m);
	}

	/**
	 * Evita que el submenú abierto se corte por abajo: lo sube lo necesario y, si
	 * aun así es más alto que el viewport, lo acota con scroll interno. (Sus items
	 * son de un solo nivel, así que el scroll no recorta submenús anidados.)
	 */
	private clampSubmenuVertical(m: number) {
		const sub = this.panelEl?.querySelector<HTMLElement>("[data-submenu]:not(.hidden)") ?? null;
		if (!sub) return;
		sub.style.top = "0px";
		sub.style.maxHeight = "";
		sub.style.overflowY = "";
		let rect = sub.getBoundingClientRect();
		if (rect.height > window.innerHeight - 2 * m) {
			sub.style.maxHeight = `${window.innerHeight - 2 * m}px`;
			sub.style.overflowY = "auto";
			rect = sub.getBoundingClientRect();
		}
		const overflow = rect.bottom - (window.innerHeight - m);
		if (overflow > 0) {
			const shift = Math.min(overflow, rect.top - m);
			if (shift > 0) sub.style.top = `${-shift}px`;
		}
	}

	private renderItem(item: ContextMenuItem, index: number, inSubmenu: boolean) {
		const children = item.children ?? [];
		const hasSubmenu = children.length > 0;
		const expanded = this.openSubmenu === index;
		const tone = item.danger ? "text-tdanger hover:bg-danger hover:text-tdanger" : "text-text hover:bg-primary hover:text-tprimary";
		const submenuSide = this.flipSubmenu ? "right-full mr-1" : "left-full ml-1";
		return (
			<div
				class="relative"
				role="none"
				onMouseEnter={() => !inSubmenu && hasSubmenu && this.openSub(index)}
				onMouseLeave={() => !inSubmenu && hasSubmenu && expanded && this.scheduleCloseSub()}
			>
				<button
					type="button"
					role="menuitem"
					aria-haspopup={hasSubmenu ? "menu" : undefined}
					aria-expanded={hasSubmenu ? String(expanded) : undefined}
					class={`flex w-full items-center gap-2 px-3 py-2 rounded-lg text-left text-sm whitespace-nowrap cursor-pointer transition-colors ${tone}`}
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
						data-submenu
						class={`absolute top-0 ${submenuSide} min-w-44 py-1 rounded-xl border border-surface bg-surface shadow-cozy text-text ${expanded ? "block" : "hidden"}`}
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
				class={`fixed z-100 min-w-52 py-1 rounded-xl border border-surface bg-surface backdrop-blur-sm shadow-cozy text-text ${
					this.visible ? "visible opacity-100" : "invisible opacity-0 pointer-events-none"
				}`}
				role="menu"
				aria-hidden={this.visible ? "false" : "true"}
			>
				{this.items.map((item, index) => this.renderItem(item, index, false))}
			</div>
		);
	}
}
