import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-icon-learning",
	styleUrl: "../adc-icon.css",
	shadow: true,
})
export class AdcIconLearning {
	@Prop() size: string = "2rem";

	render() {
		return (
			<Host>
				<svg class="adc-icon" style={{ width: this.size, height: this.size }} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3z" />
					<path d="M5 12.5v3c0 1 0.8 1.7 2 1.7h10c1.2 0 2-0.7 2-1.7v-3l-7 3.6-7-3.6z" />
					<path d="M20 8v5a1 1 0 0 0 2 0V8h-2zM21 16a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
				</svg>
			</Host>
		);
	}
}
