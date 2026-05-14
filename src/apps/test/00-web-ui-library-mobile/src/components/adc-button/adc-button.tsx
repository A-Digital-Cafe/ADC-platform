import { Component, Prop, h, Event, EventEmitter, Host } from "@stencil/core";

@Component({
	tag: "adc-button",
	shadow: true,
})
export class AdcButton {
	@Prop() disabled: boolean = false;
	@Prop() ariaLabel: string = "generic-button";
	@Prop() buttonType: "button" | "submit" | "reset" = "button";
	@Prop() variant: "primary" | "secondary" = "primary";

	@Event() adcClick: EventEmitter<MouseEvent> | undefined;

	private readonly handleClick = (event: MouseEvent) => {
		if (!this.disabled) this.adcClick?.emit(event);
	};

	render() {
		const isPrimary = this.variant === "primary";
		let backgroundColor;
		if (this.disabled) backgroundColor = "#4a5568";
		else if (isPrimary) backgroundColor = "#805ad5";
		else backgroundColor = "#2d3748";

		const hoverColor = isPrimary ? "#6b46c1" : "#1a202c";

		return (
			<Host>
				<button
					aria-label={this.ariaLabel}
					type={this.buttonType}
					onClick={() => this.handleClick}
					disabled={this.disabled}
					class="adc-button"
					style={{
						backgroundColor,
						color: "white",
						padding: "16px 24px",
						border: "none",
						borderRadius: "12px",
						fontSize: "16px",
						fontWeight: "600",
						cursor: this.disabled ? "not-allowed" : "pointer",
						transition: "all 0.3s ease",
						width: "100%",
						boxShadow: this.disabled ? "none" : "0 4px 14px rgba(128, 90, 213, 0.4)",
						textTransform: "uppercase",
						letterSpacing: "1px",
						"--hover-color": hoverColor,
					}}
					onMouseEnter={(e) => {
						if (!this.disabled) {
							(e.target as HTMLElement).style.backgroundColor = hoverColor;
							(e.target as HTMLElement).style.transform = "translateY(-2px)";
						}
					}}
					onMouseLeave={(e) => {
						if (!this.disabled) {
							(e.target as HTMLElement).style.backgroundColor = backgroundColor;
							(e.target as HTMLElement).style.transform = "translateY(0)";
						}
					}}
				>
					<slot></slot>
				</button>
			</Host>
		);
	}
}
