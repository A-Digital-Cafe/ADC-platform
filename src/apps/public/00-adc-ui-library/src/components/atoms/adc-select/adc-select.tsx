import { Component, Prop, Event, EventEmitter, State, Element } from "@stencil/core";

export interface SelectOption {
	label: string;
	value: string;
}

@Component({
	tag: "adc-select",
	shadow: false,
})
export class AdcSelect {
	@Prop() value: string = "";
	@Prop() options: SelectOption[] | string = [];
	@Prop() placeholder: string = "Seleccione";

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

	@Element() el!: HTMLElement;

	@Event() adcChange!: EventEmitter<string>;

	private readonly handleToggle = () => {
		this.isOpen = !this.isOpen;
	};

	private readonly handleSelect = (option: SelectOption) => {
		this.adcChange.emit(option.value);
		// Sync hidden native select and fire a native change event so React's onChange works
		const nativeSelect = this.el.querySelector<HTMLSelectElement>("select[data-adc-hidden]");
		if (nativeSelect) {
			nativeSelect.value = option.value;
			nativeSelect.dispatchEvent(new globalThis.Event("change", { bubbles: true }));
		}
		this.isOpen = false;
	};

	private readonly handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			this.isOpen = false;
		}
	};

	private readonly getSelectedLabel = (): string => {
		const selected = this.parsedOptions.find((opt) => opt.value === this.value);
		return selected ? selected.label : this.placeholder;
	};

	render() {
		return (
			<div class="relative w-full">
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
					class="w-full px-3 py-2 rounded-xxl border border-text/15 bg-surface text-text text-[12px] font-text flex justify-between items-center"
					aria-haspopup="menu"
					aria-expanded={this.isOpen ? "true" : "false"}
					onClick={this.handleToggle}
					onKeyDown={this.handleKeyDown}
				>
					<span>{this.getSelectedLabel()}</span>
					<svg class="h-3.5 w-3.5 text-text" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.08 1.04l-4.25 4.25a.75.75 0 0 1-1.06 0L5.25 8.27a.75.75 0 0 1-.02-1.06Z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
				{this.isOpen && (
					<div class="absolute z-50 mt-1 bg-background border border-text/15 rounded-xxl shadow-cozy max-h-60 overflow-auto w-full">
						{this.parsedOptions.map((option) => (
							<button
								type="button"
								class="px-3 py-1 cursor-pointer hover:bg-text/10 text-text w-full text-left text-[12px] font-text"
								role="menuitem"
								key={`select-${option.value}`}
								onClick={() => this.handleSelect(option)}
							>
								{option.label}
							</button>
						))}
					</div>
				)}
			</div>
		);
	}
}
