import { Component, Prop } from "@stencil/core";

@Component({
	tag: "adc-testimonial-card",
	shadow: false,
})
export class AdcTestimonialCard {
	@Prop() author: string = "";
	@Prop() staticRender: boolean = true;

	render() {
		return (
			<blockquote class="bg-surface shadow-cozy custom-surface rounded-xxl p-4 w-full max-w-120 mx-auto">
				<adc-text class="italic">
					<slot></slot>
				</adc-text>
				<footer class="mt-2 font-heading p-text">— {this.author}</footer>
			</blockquote>
		);
	}
}
