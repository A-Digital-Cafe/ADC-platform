import { Component, Prop, Event, EventEmitter, State } from "@stencil/core";

@Component({
	tag: "adc-search-input",
	shadow: false,
})
export class AdcSearchInput {
	@Prop() value: string = "";
	@Prop() placeholder: string = "";
	@Prop() inputId?: string = "";
	@Prop() name?: string = "";
	@Prop() type?: string = "text";
	@Prop() autocomplete?: string = "off";
	@Prop() ariaLabel?: string = "";
	@Prop() debounce: number = 300;

	@State() innerValue: string = "";

	private debounceTimer?: ReturnType<typeof setTimeout>;

	@Event() adcInput!: EventEmitter<string>;

	componentWillLoad() {
		this.innerValue = this.value;
	}

	private readonly handleInput = (event: Event) => {
		const target = event.target as HTMLInputElement;
		this.innerValue = target.value;

		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		if (this.debounce > 0) {
			this.debounceTimer = setTimeout(() => {
				this.adcInput.emit(this.innerValue);
			}, this.debounce);
		} else {
			this.adcInput.emit(this.innerValue);
		}
	};

	disconnectedCallback() {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
	}

	render() {
		const labelClass = "relative flex items-center w-full bg-transparent rounded-xxl ";
		const iconClass = "absolute left-[0.9rem] z-10 mb-0 inline-flex items-center justify-center text-text/40 pointer-events-none";
		const inputClass =
			"flex-1 bg-surface border border-text/15 outline-none py-[0.6rem] pr-[0.8rem] pl-[2.5rem] rounded-xxl font-text text-[0.9rem] text-text";

		return (
			<label htmlFor={this.inputId || undefined} class={labelClass}>
				<span class={iconClass} aria-hidden="true">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						class="w-4 h-4"
					>
						<circle cx="11" cy="11" r="6" />
						<line x1="17" y1="17" x2="21" y2="21" stroke-linecap="round" />
					</svg>
				</span>
				<input
					id={this.inputId || undefined}
					value={this.innerValue}
					placeholder={this.placeholder}
					name={this.name || undefined}
					type={this.type}
					autocomplete={this.autocomplete}
					aria-label={this.ariaLabel || this.placeholder || this.name}
					class={inputClass}
					onInput={this.handleInput}
				/>
			</label>
		);
	}
}
