import { Component, Prop } from "@stencil/core";

@Component({
	tag: "adc-feature-card",
	shadow: false,
})
export class AdcFeatureCard {
	@Prop() title: string = "";
	@Prop() staticRender: boolean = true;

	render() {
		return (
			<article class="bg-surface shadow-cozy custom-surface rounded-xxl p-4 text-center flex flex-col items-center w-full max-w-120 mx-auto">
				<div class="mt-2" aria-hidden="true">
					<slot name="icon"></slot>
				</div>
				<h3 style={{ marginTop: "0.5rem" }}>{this.title}</h3>
				<adc-text>
					<slot></slot>
				</adc-text>
			</article>
		);
	}
}
