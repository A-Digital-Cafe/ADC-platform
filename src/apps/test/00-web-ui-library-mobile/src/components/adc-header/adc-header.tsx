import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-header",
	shadow: true,
})
export class AdcHeader {
	@Prop() headerTitle!: string;
	@Prop() subtitle?: string;

	render() {
		return (
			<Host>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						textAlign: "center",
						marginBottom: "24px",
						paddingBottom: "16px",
						borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
					}}
				>
					<div style={{ flex: "1" }}>
						<h1 style={{ 
							margin: "0", 
							fontSize: "1.5rem", 
							color: "#e2e8f0",
							fontWeight: "700",
							letterSpacing: "-0.5px"
						}}>
							{this.headerTitle}
						</h1>
						{this.subtitle && (
							<p style={{ 
								margin: "8px 0 0 0", 
								color: "#a0aec0",
								fontSize: "0.875rem"
							}}>
								{this.subtitle}
							</p>
						)}
					</div>
					<div style={{ marginTop: "12px" }}>
						<slot name="actions"></slot>
					</div>
				</div>
			</Host>
		);
	}
}

