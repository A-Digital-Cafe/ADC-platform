import { Component, Prop, Event, EventEmitter, State, Listen, Element } from "@stencil/core";

export interface DropdownMenuItem {
	label: string;
	to?: string;
	action?: string;
	icon?: any;
	/** Submenú anidado (un nivel); el item padre no emite click propio. */
	children?: DropdownMenuItem[];
}

@Component({
	tag: "adc-dropdown-menu",
	shadow: false,
})
export class AdcDropdownMenu {
	@Prop() items: DropdownMenuItem[] = [];
	@Prop() alignState: "left" | "right" = "left";
	@Prop() openOnHover: boolean = true;
	/** Posiciona el panel con `position: fixed` (calculado desde el trigger) para
	 * que no lo recorte un contenedor con `overflow` (ej: paneles laterales). */
	@Prop() floating: boolean = false;

	@State() isOpen: boolean = false;
	/** Índice del item de nivel superior cuyo submenú está abierto. */
	@State() openSubmenu: number | null = null;
	/** Coordenadas de viewport del panel cuando `floating` está activo. */
	@State() menuPos?: { top: number; left: number };

	@Element() el!: HTMLElement;

	@Event() adcItemClick!: EventEmitter<DropdownMenuItem>;

	private hoverTimeout?: ReturnType<typeof setTimeout>;
	private triggerEl?: HTMLButtonElement;

	/** Ancho del panel (`w-56` = 14rem = 224px), usado para el clamp en modo floating. */
	private static readonly PANEL_WIDTH = 224;

	private updatePosition() {
		if (!this.floating || !this.triggerEl) return;
		const r = this.triggerEl.getBoundingClientRect();
		const raw = this.alignState === "right" ? r.right - AdcDropdownMenu.PANEL_WIDTH : r.left;
		const left = Math.max(4, Math.min(raw, window.innerWidth - AdcDropdownMenu.PANEL_WIDTH - 4));
		this.menuPos = { top: r.bottom + 2, left };
	}

	@Listen("mouseenter")
	handleMouseEnter() {
		if (!this.openOnHover) return;
		if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
		this.updatePosition();
		this.isOpen = true;
	}

	@Listen("mouseleave")
	handleMouseLeave() {
		if (!this.openOnHover) return;
		this.hoverTimeout = setTimeout(() => {
			this.isOpen = false;
			this.openSubmenu = null;
		}, 150);
	}

	@Listen("focusin")
	handleFocusIn() {
		// Sólo los menús tipo hover abren al recibir foco. En modo click (openOnHover
		// = false) abrir acá entraba en conflicto con `handleToggle`: el mousedown
		// enfocaba el trigger (abría) y el click del mismo gesto lo volvía a cerrar.
		if (!this.openOnHover) return;
		if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
		this.updatePosition();
		this.isOpen = true;
	}

	@Listen("focusout")
	handleFocusOut(event: FocusEvent) {
		const relatedTarget = event.relatedTarget as HTMLElement | null;
		if (relatedTarget && this.el.contains(relatedTarget)) return;
		this.hoverTimeout = setTimeout(() => {
			this.isOpen = false;
			this.openSubmenu = null;
		}, 150);
	}

	@Listen("keydown")
	handleKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			this.isOpen = false;
			this.openSubmenu = null;
		}
	}

	private readonly handleToggle = () => {
		if (!this.isOpen) this.updatePosition();
		this.isOpen = !this.isOpen;
		if (!this.isOpen) this.openSubmenu = null;
	};

	private readonly handleItemClick = (item: DropdownMenuItem) => {
		if (item.children?.length) return; // los padres sólo expanden submenú
		this.adcItemClick.emit(item);
		this.isOpen = false;
		this.openSubmenu = null;
	};

	disconnectedCallback() {
		if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
	}

	private static readonly keyPrefix = "adc-dropdown-item-";

	private renderItem(item: DropdownMenuItem, index: number, inSubmenu: boolean) {
		const children = item.children ?? [];
		const hasSubmenu = children.length > 0;
		const expanded = this.openSubmenu === index;
		const baseClass = "flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-accent whitespace-normal wrap-break-word";

		if (item.to && !hasSubmenu) {
			return (
				<a key={AdcDropdownMenu.keyPrefix + index} href={item.to} class={baseClass} role="menuitem" tabindex={-1} onClick={() => this.handleItemClick(item)}>
					<span class="flex-1 min-w-0 leading-snug wrap-break-word">{item.label}</span>
				</a>
			);
		}

		return (
			<div
				class="relative"
				role="none"
				onMouseEnter={() => hasSubmenu && !inSubmenu && (this.openSubmenu = index)}
				onMouseLeave={() => hasSubmenu && !inSubmenu && expanded && (this.openSubmenu = null)}
			>
				<button
					key={AdcDropdownMenu.keyPrefix + index}
					type="button"
					class={baseClass}
					role="menuitem"
					aria-haspopup={hasSubmenu ? "menu" : undefined}
					aria-expanded={hasSubmenu ? String(expanded) : undefined}
					tabindex={-1}
					onClick={() => this.handleItemClick(item)}
				>
					<span class="flex-1 min-w-0 leading-snug wrap-break-word">{item.label}</span>
					{hasSubmenu && (
						<svg class="w-3 h-3 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
						</svg>
					)}
				</button>
				{hasSubmenu && (
					<div class={`absolute top-0 left-full ml-0.5 w-48 rounded shadow z-50 bg-primary text-tprimary ${expanded ? "block" : "hidden"}`} role="menu">
						{children.map((child, i) => this.renderItem(child, i, true))}
					</div>
				)}
			</div>
		);
	}

	render() {
		const alignClass = this.alignState === "right" ? "right-0" : "left-0";
		const panelClass = this.floating ? "fixed z-100" : `absolute top-full z-50 ${alignClass}`;
		const panelStyle = this.floating && this.menuPos ? { top: `${this.menuPos.top}px`, left: `${this.menuPos.left}px` } : undefined;

		return (
			<div class="relative inline-block" role="group">
				<button
					type="button"
					class="group inline-flex items-center bg-transparent!"
					aria-haspopup="menu"
					aria-expanded={this.isOpen ? "true" : "false"}
					onClick={this.handleToggle}
					ref={(el) => (this.triggerEl = el as HTMLButtonElement)}
				>
					<slot>Menú</slot>
				</button>

				{this.isOpen && (
					<div class={`${panelClass} w-56 rounded shadow bg-primary text-tprimary`} style={panelStyle} role="menu" aria-orientation="vertical">
						{this.items.map((item, index) => this.renderItem(item, index, false))}
					</div>
				)}
			</div>
		);
	}
}
