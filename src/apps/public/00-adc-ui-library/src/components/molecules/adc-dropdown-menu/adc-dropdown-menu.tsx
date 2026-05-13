import { Component, Prop, h, Event, EventEmitter, State, Listen, Element } from "@stencil/core";

export interface DropdownMenuItem {
	label: string;
	to?: string;
	action?: string;
	icon?: any;
}

@Component({
	tag: "adc-dropdown-menu",
	shadow: false,
})
export class AdcDropdownMenu {
	@Prop() items: DropdownMenuItem[] = [];
	@Prop() alignState: "left" | "right" = "left";
	@Prop() openOnHover: boolean = true;

	@State() isOpen: boolean = false;

	@Element() el!: HTMLElement;

	@Event() adcItemClick!: EventEmitter<DropdownMenuItem>;

	private hoverTimeout?: ReturnType<typeof setTimeout>;

	@Listen("mouseenter")
	handleMouseEnter() {
		if (!this.openOnHover) return;
		if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
		this.isOpen = true;
	}

	@Listen("mouseleave")
	handleMouseLeave() {
		if (!this.openOnHover) return;
		this.hoverTimeout = setTimeout(() => {
			this.isOpen = false;
		}, 150);
	}

	@Listen("focusin")
	handleFocusIn() {
		if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
		this.isOpen = true;
	}

	@Listen("focusout")
	handleFocusOut(event: FocusEvent) {
		const relatedTarget = event.relatedTarget as HTMLElement | null;
		if (relatedTarget && this.el.contains(relatedTarget)) return;
		this.hoverTimeout = setTimeout(() => {
			this.isOpen = false;
		}, 150);
	}

	@Listen("keydown")
	handleKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			this.isOpen = false;
		}
	}

	private readonly handleToggle = () => {
		this.isOpen = !this.isOpen;
	};

	private readonly handleItemClick = (item: DropdownMenuItem) => {
		this.adcItemClick.emit(item);
		this.isOpen = false;
	};

	disconnectedCallback() {
		if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
	}

	private static readonly keyPrefix = "adc-dropdown-item-";

	render() {
		void h;
		const alignClass = this.alignState === "right" ? "right-0" : "left-0";

		return (
			<div class="relative inline-block" role="group">
				<button
					type="button"
					class="group inline-flex items-center bg-transparent!"
					aria-haspopup="menu"
					aria-expanded={this.isOpen ? "true" : "false"}
					onClick={this.handleToggle}
				>
					<slot>Menú</slot>
				</button>

				{this.isOpen && (
					<div
						class={`absolute top-full w-56 rounded shadow z-50 bg-primary text-tprimary ${alignClass}`}
						role="menu"
						aria-orientation="vertical"
					>
						{this.items.map((item, index) => {
							if (item.to) {
								return (
									<a
										key={AdcDropdownMenu.keyPrefix + index}
										href={item.to}
										class="flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-accent whitespace-normal wrap-break-word"
										role="menuitem"
										tabindex={-1}
										onClick={() => this.handleItemClick(item)}
									>
										<span class="flex-1 min-w-0 leading-snug wrap-break-word">{item.label}</span>
									</a>
								);
							}
							return (
								<button
									key={AdcDropdownMenu.keyPrefix + index}
									type="button"
									class="flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-accent whitespace-normal wrap-break-word"
									role="menuitem"
									tabindex={-1}
									onClick={() => this.handleItemClick(item)}
								>
									<span class="flex-1 min-w-0 leading-snug wrap-break-word">{item.label}</span>
								</button>
							);
						})}
					</div>
				)}
			</div>
		);
	}
}
