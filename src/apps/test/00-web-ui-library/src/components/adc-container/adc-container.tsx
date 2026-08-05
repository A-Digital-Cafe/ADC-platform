import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-container",
	shadow: true,
})
export class AdcContainer {
	@Prop() maxWidth: string = "1200px";
	@Prop() padding: string = "20px";

	render() {
		return (
			<Host>
				<div style={{ padding: this.padding }}>
					<div
						style={{
							maxWidth: this.maxWidth,
							margin: "0 auto",
							background: "white",
							padding: "30px",
							borderRadius: "8px",
							boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
						}}
					>
						<slot></slot>
					</div>
				</div>
			</Host>
		);
	}
}
