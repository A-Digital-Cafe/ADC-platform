import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-container",
	shadow: true,
})
export class AdcContainer {
	@Prop() maxWidth: string = "100%";
	@Prop() padding: string = "16px";

	render() {
		return (
			<Host>
				<div style={{ 
					padding: this.padding,
					minHeight: "100vh",
					background: "linear-gradient(180deg, #1a202c 0%, #0d1117 100%)"
				}}>
					<div
						style={{
							maxWidth: this.maxWidth,
							margin: "0 auto",
							background: "rgba(26, 32, 44, 0.8)",
							padding: "20px",
							borderRadius: "20px",
							boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
							backdropFilter: "blur(10px)",
							border: "1px solid rgba(255, 255, 255, 0.05)",
						}}
					>
						<slot></slot>
					</div>
				</div>
			</Host>
		);
	}
}

