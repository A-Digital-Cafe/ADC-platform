import { Component, Prop } from "@stencil/core";

@Component({
	tag: "adc-divider",
	shadow: false,
})
export class AdcDivider {
	@Prop() text?: string;

	render() {
		if (this.text) {
			return (
				<div class="flex items-center gap-3">
					<span class="text-accent font-medium tracking-[0.15em] text-xs uppercase">{this.text}</span>
					<div class="h-px flex-1 bg-accent/15" />
				</div>
			);
		}

		return <hr class="my-4 border-surface" aria-label="Separador" />;
	}
}
