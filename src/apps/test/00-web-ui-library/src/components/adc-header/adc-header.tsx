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
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: "30px",
						paddingBottom: "20px",
						borderBottom: "2px solid #e5e7eb",
					}}
				>
					<div>
						<h1 style={{ margin: "0", fontSize: "2rem", color: "#111827" }}>{this.headerTitle}</h1>
						{this.subtitle && <p style={{ margin: "8px 0 0 0", color: "#6b7280" }}>{this.subtitle}</p>}
					</div>
					<div>
						<slot name="actions"></slot>
					</div>
				</div>
			</Host>
		);
	}
}
