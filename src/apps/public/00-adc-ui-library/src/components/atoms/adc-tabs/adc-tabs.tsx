import { Component, Prop, Event, EventEmitter, Watch, State, Element } from "@stencil/core";
import { sanitizeSvg } from "../../../../utils/sanitize-svg.js";

export interface TabItem {
	id: string;
	label: string;
	icon?: string;
	disabled?: boolean;
}

@Component({
	tag: "adc-tabs",
	shadow: false,
})
export class AdcTabs {
	@Element() el!: HTMLElement;

	/** Tab items to display */
	@Prop() tabs: TabItem[] | string = [];

	/** Currently active tab ID */
	@Prop({ mutable: true }) activeTab: string = "";

	/** Visual variant */
	@Prop() variant: "underline" | "pills" = "underline";

	/** Internal state synced with prop */
	@State() internalActive: string = "";

	@Event() adcTabChange!: EventEmitter<string>;

	/** Carril con `overflow-x`, el que realmente scrollea. */
	private trackEl?: HTMLElement;

	/** Normalizes tabs prop — handles both array and JSON string input */
	private get parsedTabs(): TabItem[] {
		if (typeof this.tabs === "string") {
			try {
				return JSON.parse(this.tabs);
			} catch {
				return [];
			}
		}
		return this.tabs || [];
	}

	@Watch("activeTab")
	onActiveTabChange(newVal: string) {
		this.internalActive = newVal;
	}

	componentWillLoad() {
		this.internalActive = this.activeTab || this.parsedTabs[0]?.id || "";
	}

	componentDidRender() {
		this.scrollActiveIntoView();
	}

	/**
	 * La fila scrollea en horizontal, así que la tab activa puede quedar fuera de vista
	 * (navegación por teclado, o entrar directo a una sección del final). Se mueve sólo
	 * `scrollLeft` del carril — `scrollIntoView` arrastraría también la página.
	 */
	private scrollActiveIntoView() {
		const track = this.trackEl;
		if (!track || track.scrollWidth <= track.clientWidth) return;
		const active = track.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
		if (!active) return;

		const trackRect = track.getBoundingClientRect();
		const rect = active.getBoundingClientRect();
		if (rect.left < trackRect.left) track.scrollLeft -= trackRect.left - rect.left;
		else if (rect.right > trackRect.right) track.scrollLeft += rect.right - trackRect.right;
	}

	private readonly handleTabClick = (tab: TabItem) => {
		if (tab.disabled) return;
		this.internalActive = tab.id;
		this.adcTabChange.emit(tab.id);
	};

	private readonly handleKeyDown = (event: KeyboardEvent, tab: TabItem) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			this.handleTabClick(tab);
		}
		if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
			const enabledTabs = this.parsedTabs.filter((t) => !t.disabled);
			const currentIdx = enabledTabs.findIndex((t) => t.id === this.internalActive);
			const offset = event.key === "ArrowRight" ? 1 : -1;
			const nextIdx = (currentIdx + offset + enabledTabs.length) % enabledTabs.length;
			this.handleTabClick(enabledTabs[nextIdx]);
		}
	};

	render() {
		const isUnderline = this.variant === "underline";

		// `w-max min-w-full`: la fila crece con las tabs pero nunca es más angosta que el
		// carril, así el borde inferior/el fondo siguen cubriendo todo el ancho visible.
		const rowClass = isUnderline ? "flex border-b border-surface gap-1 w-max min-w-full" : "flex gap-1 bg-surface/30 rounded-xxl p-1 w-max min-w-full";

		return (
			// El carril acota el ancho al del layout y deja recorrer las tabs con el dedo en
			// vez de desbordar la página en mobile.
			<div class="max-w-full overflow-x-auto overscroll-x-contain" ref={(el) => (this.trackEl = el)}>
				<div class={rowClass} role="tablist" aria-orientation="horizontal">
					{this.parsedTabs.map((tab) => {
						const isActive = tab.id === this.internalActive;
						const isDisabled = tab.disabled;

						let baseClass: string;
						if (isUnderline) {
							const stateClass = isActive
								? "border-primary text-primary font-semibold"
								: "border-transparent text-muted hover:text-text hover:border-surface";

							baseClass = `px-4 py-2 font-text text-base cursor-pointer transition-colors border-b-2 -mb-[1px] min-h-[44px] min-w-[44px] touch-manipulation ${stateClass}`;
						} else {
							const stateClass = isActive
								? "bg-primary text-tprimary font-semibold shadow-cozy"
								: "text-muted hover:text-text hover:bg-surface/50";

							baseClass = `px-4 py-2 font-text text-base cursor-pointer transition-colors rounded-xxl min-h-[44px] min-w-[44px] touch-manipulation ${stateClass}`;
						}

						const disabledClass = isDisabled ? "opacity-40 cursor-not-allowed pointer-events-none" : "";

						return (
							<button
								type="button"
								key={`tab-${tab.id}`}
								role="tab"
								aria-selected={isActive ? "true" : "false"}
								aria-disabled={isDisabled ? "true" : undefined}
								tabindex={isActive ? 0 : -1}
								// `shrink-0` + `whitespace-nowrap`: dentro del carril las tabs no se
								// comprimen ni parten el label, se salen y se recorren scrolleando.
								class={`${baseClass} ${disabledClass} shrink-0 whitespace-nowrap`}
								onClick={() => this.handleTabClick(tab)}
								onKeyDown={(e) => this.handleKeyDown(e, tab)}
							>
								{tab.icon && <span class="mr-1.5" innerHTML={sanitizeSvg(tab.icon)}></span>}
								{tab.label}
							</button>
						);
					})}
				</div>
			</div>
		);
	}
}
