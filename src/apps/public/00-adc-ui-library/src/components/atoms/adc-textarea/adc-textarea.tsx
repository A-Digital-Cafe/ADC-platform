import { Component, Prop } from "@stencil/core";

@Component({
	tag: "adc-textarea",
	shadow: false,
})
export class AdcTextarea {
	@Prop() value: string = "";
	@Prop() placeholder?: string = "";
	@Prop() textareaId?: string = "";
	@Prop() name?: string = "";
	@Prop() rows?: number = 3;
	@Prop() ariaLabel?: string = "";
	@Prop() disabled?: boolean = false;

	render() {
		return (
			<textarea
				id={this.textareaId}
				name={this.name}
				placeholder={this.placeholder}
				rows={this.rows}
				disabled={this.disabled}
				aria-label={this.ariaLabel || this.placeholder || this.name}
				class="w-full px-3 py-2 rounded-xxl border border-text/15 bg-surface font-text text-[12px] text-text resize-y disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{this.value}
			</textarea>
		);
	}
}
