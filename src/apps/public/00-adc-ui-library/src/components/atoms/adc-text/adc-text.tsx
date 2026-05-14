import { Component, Prop } from "@stencil/core";

@Component({
	tag: "adc-text",
	shadow: false,
})
export class AdcText {
	@Prop() staticRender: boolean = true;
	@Prop() contain: boolean = true;

	render() {
		return (
			<p class={this.contain ? "contain-content" : ""}>
				<slot></slot>
			</p>
		);
	}
}
