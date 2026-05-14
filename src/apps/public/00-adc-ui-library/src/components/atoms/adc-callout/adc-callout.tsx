import { Component, Prop } from "@stencil/core";

@Component({
	tag: "adc-callout",
	shadow: false,
})
export class AdcCallout {
	@Prop() tone: "info" | "warning" | "success" | "error" = "info";
	@Prop() role: "note" | "status" | "alert" = "note";

	private getToneClass(): string {
		// Usa las variables CSS semánticas que soportan dark mode
		switch (this.tone) {
			case "warning":
				return "bg-warn text-twarn border-twarn/45";
			case "success":
				return "bg-success text-tsuccess border-tsuccess/45";
			case "error":
				return "bg-danger text-tdanger border-tdanger/45";
			default:
				return "bg-info text-tinfo border-tinfo/45";
		}
	}

	render() {
		const classes = `rounded-xxl border p-3 mb-2 ml-8 xl:max-w-[80vw] ${this.getToneClass()}`;

		if (this.role === "note") {
			return (
				<aside class={classes} role="note">
					<slot></slot>
				</aside>
			);
		}

		if (this.role === "status") {
			return (
				<output class={classes} aria-live="polite" aria-atomic="false">
					<slot></slot>
				</output>
			);
		}

		return (
			<div class={classes} role="alert" aria-live="assertive" aria-atomic="true">
				<slot></slot>
			</div>
		);
	}
}
