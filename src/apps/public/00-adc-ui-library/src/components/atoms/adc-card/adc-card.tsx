import { Component, Host } from "@stencil/core";

@Component({
	tag: "adc-card",
	shadow: false,
})
export class AdcCard {
	render() {
		return (
			<Host class="block bg-surface text-text shadow-cozy rounded-xxl border border-text/10">
				<slot></slot>
			</Host>
		);
	}
}
