import { Component, Prop, Host } from "@stencil/core";

@Component({
	tag: "adc-stat-card",
	shadow: true,
})
export class AdcStatCard {
	@Prop() cardTitle!: string;
	@Prop() value!: string | number;
	@Prop() description?: string;
	@Prop() color: string = "#805ad5";

	render() {
		return (
			<Host>
				<div
					style={{
						background: "linear-gradient(145deg, #2d3748 0%, #1a202c 100%)",
						padding: "20px",
						borderRadius: "16px",
						border: "1px solid rgba(255, 255, 255, 0.05)",
						boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
					}}
				>
					<h3
						style={{
							margin: "0 0 8px 0",
							fontSize: "36px",
							color: this.color,
							fontWeight: "800",
							textShadow: `0 0 20px ${this.color}40`,
						}}
					>
						{this.value}
					</h3>
					<p style={{ 
						margin: "0", 
						color: "#e2e8f0", 
						fontWeight: "500",
						fontSize: "14px",
						textTransform: "uppercase",
						letterSpacing: "0.5px"
					}}>
						{this.cardTitle}
					</p>
					{this.description && (
						<p style={{ 
							margin: "8px 0 0 0", 
							fontSize: "0.75rem", 
							color: "#718096" 
						}}>
							{this.description}
						</p>
					)}
				</div>
			</Host>
		);
	}
}

