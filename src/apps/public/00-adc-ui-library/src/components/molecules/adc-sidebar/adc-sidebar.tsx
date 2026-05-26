import { Component, Prop, Event, EventEmitter, State, Element } from "@stencil/core";

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
	@Prop() title: string = "";
	@Prop() subtitle: string = "";

	@State() internalActiveItem: string | null = null;

	@Element() el!: HTMLElement;

	@Event() adcSidebarItemClick!: EventEmitter<SidebarItem>;

	private readonly handleItemClick = (item: SidebarItem) => {
		this.adcSidebarItemClick.emit(item);
	};

	render() {
		const sidebarClass = this.collapsed ? "w-35 lg:w-74" : "w-74";

		return (
			<aside
				class={`z-20 fixed left-0 px-2 pt-5 pr-6 bg-background text-primary transition-[width] duration-300 shadow-[0_5px_20px_rgba(0,0,0,0.15)] overflow-hidden ${sidebarClass}`}
				style={{
					top: "var(--header-offset)",
					height: "calc(100vh - var(--header-offset))",
				}}
			>
				{(this.title || this.subtitle) && (
					<div
						class={`flex flex-col justify-center items-center px-3 mb-4 transition-opacity duration-300 ${
							this.collapsed ? "opacity-0 pointer-events-none lg:opacity-100 lg:pointer-events-auto" : "opacity-100"
						}`}
					>
						{this.title && <h2 class="mb-0! truncate">{this.title}</h2>}
						{this.subtitle && <p class="text-sm text-primary opacity-70 truncate">{this.subtitle}</p>}
					</div>
				)}

				<adc-divider />

				<nav class="flex flex-col gap-4 p-2">
					{this.items.map((item) => {
						return (
							<div key={item.label}>
								<a
									href={item.to}
									class={`flex gap-2 transition-all duration-300 py-3 rounded w-full items-center cursor-pointer ${
										this.collapsed ? "justify-center px-0" : "justify-start gap-2 px-3"
									} ${this.activeItem === item.action ? "bg-primary text-tprimary" : "hover:bg-primary hover:text-tprimary"}`}
									onClick={() => this.handleItemClick(item)}
									title={this.collapsed ? item.label : ""}
								>
									{item.iconSvg && (
										<span
											class="flex items-center justify-center shrink-0 w-adc-xl h-adc-xl"
											innerHTML={item.iconSvg}
										></span>
									)}

									<span
										class={`flex-1 overflow-hidden transition-all duration-300 ${
											this.collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100"
										} lg:max-w-40 lg:opacity-100`}
									>
										<span class="text-left whitespace-nowrap text-lg font-semibold ">{item.label}</span>

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
