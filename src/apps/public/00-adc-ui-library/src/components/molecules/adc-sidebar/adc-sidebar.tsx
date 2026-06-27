import { Component, Prop, Event, EventEmitter, State, Element } from "@stencil/core";
import { sanitizeSvg } from "../../../../utils/sanitize-svg.js";

export interface SidebarItem {
	label: string;
	iconSvg?: string;
	to?: string;
	action?: string;
	children?: SidebarItem[];
	badge?: string;
}

@Component({
	tag: "adc-sidebar",
	shadow: false,
})
export class AdcSidebar {
	@Prop() items: SidebarItem[] = [];
	@Prop() collapsed: boolean = false;
	@Prop() activeItem: string | null = null;
	@Prop({ attribute: "title" }) sectionTitle: string = "";
	@Prop() subtitle: string = "";

	@State() internalActiveItem: string | null = null;

	@Element() el!: HTMLElement;

	@Event() adcSidebarItemClick!: EventEmitter<SidebarItem>;

	private readonly handleItemClick = (item: SidebarItem) => {
		this.adcSidebarItemClick.emit(item);
	};

	render() {
		// Mobile (<lg): drawer off-canvas — oculto al colapsar, overlay al expandir.
		// Desktop (lg+): siempre visible (rail/expandido), idéntico al comportamiento previo.
		const sidebarClass = this.collapsed
			? "w-32 lg:w-max lg:min-w-74 -translate-x-full lg:translate-x-0"
			: "w-[85vw] max-w-80 lg:w-max lg:min-w-74 lg:max-w-none translate-x-0";

		return (
			<aside
				class={`z-20 fixed left-0 px-2 pt-5 pr-6 bg-background text-primary transition-transform lg:transition-[width] duration-300 shadow-[0_5px_20px_rgba(0,0,0,0.15)] overflow-hidden ${sidebarClass}`}
				style={{
					top: "var(--header-offset)",
					height: "calc(100vh - var(--header-offset))",
				}}
			>
				{(this.sectionTitle || this.subtitle) && (
					<div class={`flex flex-col justify-center items-center gap-2 px-3 my-4 transition-opacity duration-300 `}>
						<span
							class={`flex flex-col items-center justify-center min-w-0 transition-all duration-300 lg:flex-col
						${this.collapsed ? "hidden lg:flex lg:flex-1 lg:opacity-100 lg:pointer-events-auto" : "flex-1 opacity-100"}`}
						>
							{this.sectionTitle && <h2 class="my-0! truncate">{this.sectionTitle}</h2>}
							{this.subtitle && <p class="text-sm text-primary opacity-70 truncate">{this.subtitle}</p>}
						</span>

						<span class="shrink-0">
							<slot name="actions" />
						</span>
					</div>
				)}

				<adc-divider />

				<nav class="flex flex-col gap-4 p-2">
					{this.items.map((item) => {
						return (
							<div key={item.label}>
								<a
									href={item.to}
									class={`flex gap-2 transition-all duration-300 py-3 rounded w-full lg:px-4 items-center cursor-pointer ${
										this.collapsed ? "justify-center px-0" : "justify-start gap-2 px-4"
									} ${this.activeItem === item.action ? "bg-primary text-tprimary" : "hover:bg-primary hover:text-tprimary"}`}
									onClick={() => this.handleItemClick(item)}
									title={this.collapsed ? item.label : ""}
								>
									{item.iconSvg && (
										<span
											class="flex items-center justify-center shrink-0 w-adc-xl h-adc-xl"
											innerHTML={sanitizeSvg(item.iconSvg)}
										></span>
									)}

									<span
										class={`flex-1 transition-all duration-300 lg:flex ${
											this.collapsed ? "hidden max-w-0 opacity-0 overflow-hidden" : "max-w-none opacity-100"
										} lg:max-w-none lg:opacity-100 lg:overflow-visible`}
									>
										<span class="text-left whitespace-nowrap text-lg font-semibold">{item.label}</span>

										{item.badge && <span class="ml-auto badge badge-sm">{item.badge}</span>}
									</span>
								</a>
							</div>
						);
					})}
				</nav>
			</aside>
		);
	}
}
