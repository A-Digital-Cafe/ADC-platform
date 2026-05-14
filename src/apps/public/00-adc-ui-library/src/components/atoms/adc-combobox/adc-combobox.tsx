import { Component, Prop, Event, EventEmitter, State, Watch } from "@stencil/core";

export interface ComboboxOption {
	label: string;
	value: string;
}

@Component({
	tag: "adc-combobox",
	shadow: false,
})
export class AdcCombobox {
	/** Currently selected value */
	@Prop() value: string = "";

	/** Available options — accepts an array or a JSON string */
	@Prop() options: ComboboxOption[] | string = [];

	/** Placeholder text when nothing is selected */
	@Prop() placeholder: string = "";

	/** Debounce delay in ms for search input */
	@Prop() debounce: number = 200;

	/** Whether the combobox is disabled */
	@Prop() disabled: boolean = false;

	/** Whether to show the clear (x) button when a value is selected. Default: true. */
	@Prop() clearable: boolean = true;

	/** Normalizes options prop — handles both array and JSON string */
	private get parsedOptions(): ComboboxOption[] {
		if (typeof this.options === "string") {
			try {
				return JSON.parse(this.options);
			} catch {
				return [];
			}
		}
		return this.options || [];
	}

	private get filteredOptions(): ComboboxOption[] {
		if (!this.searchQuery) return this.parsedOptions;
		const q = this.searchQuery.toLowerCase();
		return this.parsedOptions.filter((opt) => opt.label.toLowerCase().includes(q));
	}

	@State() searchQuery: string = "";
	@State() inputValue: string = "";
	@State() isOpen: boolean = false;

	@Event() adcChange!: EventEmitter<string>;

	@Watch("value")
	onValueChange() {
		this.searchQuery = "";
		this.inputValue = "";
		this.isOpen = false;
	}

	private debounceTimer?: ReturnType<typeof setTimeout>;

	private get selectedLabel(): string {
		const selected = this.parsedOptions.find((opt) => opt.value === this.value);
		return selected ? selected.label : "";
	}

	disconnectedCallback() {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
	}

	private readonly handleFocus = () => {
		this.isOpen = true;
		this.searchQuery = "";
		this.inputValue = "";
	};

	private readonly handleInput = (event: InputEvent) => {
		const target = event.target as HTMLInputElement;
		this.inputValue = target.value;
		this.isOpen = true;

		if (this.debounceTimer) clearTimeout(this.debounceTimer);

		if (this.debounce > 0) {
			this.debounceTimer = setTimeout(() => {
				this.searchQuery = this.inputValue;
			}, this.debounce);
		} else {
			this.searchQuery = this.inputValue;
		}
	};

	private readonly handleBlur = () => {
		// Delay so mousedown on an option fires before the dropdown closes
		setTimeout(() => {
			this.isOpen = false;
			this.searchQuery = "";
			this.inputValue = "";
		}, 150);
	};

	private readonly handleSelect = (option: ComboboxOption) => {
		this.adcChange.emit(option.value);
		this.isOpen = false;
		this.searchQuery = "";
		this.inputValue = "";
	};

	private readonly handleClear = (event: MouseEvent) => {
		event.stopPropagation();
		this.adcChange.emit("");
		this.searchQuery = "";
		this.inputValue = "";
		this.isOpen = false;
	};

	render() {
		const displayValue = this.isOpen ? this.inputValue : this.selectedLabel;
		const options = this.filteredOptions;

		return (
			<div class="relative w-full">
				<input
					type="text"
					class="w-full px-3 py-2 pr-14 rounded-lg border border-text/15 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted disabled:opacity-40 disabled:cursor-not-allowed"
					placeholder={this.placeholder}
					value={displayValue}
					onFocus={this.handleFocus}
					onInput={this.handleInput}
					onBlur={this.handleBlur}
					disabled={this.disabled}
					autocomplete="off"
				/>

				{this.isOpen && options.length > 0 && (
					<ul class="absolute z-9999 w-full mt-1 bg-background border border-text/15 rounded-xxl shadow-cozy max-h-60 overflow-auto">
						{options.map((option) => (
							<li
								key={option.value}
								class="px-3 py-1 text-[12px] font-text text-text cursor-pointer hover:bg-text/10 select-none"
								onMouseDown={(e: MouseEvent) => {
									e.preventDefault();
									this.handleSelect(option);
								}}
							>
								{option.label}
							</li>
						))}
					</ul>
				)}

				<div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
					{this.clearable && this.value && (
						<button
							type="button"
							class="pointer-events-auto text-muted hover:text-text transition-colors cursor-pointer"
							onClick={this.handleClear}
							aria-label="Clear"
							tabindex={-1}
						>
							<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M18 6L6 18M6 6l12 12" />
							</svg>
						</button>
					)}
					<svg
						class={`w-4 h-4 text-muted transition-transform ${this.isOpen ? "rotate-180" : ""}`}
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path d="M6 9l6 6 6-6" />
					</svg>
				</div>
			</div>
		);
	}
}
