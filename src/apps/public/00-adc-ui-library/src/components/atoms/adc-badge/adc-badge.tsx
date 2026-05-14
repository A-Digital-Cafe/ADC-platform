import { Component, Prop } from "@stencil/core";

@Component({
	tag: "adc-badge",
	shadow: false,
})
export class AdcBadge {
	/** Badge color */
	@Prop() color: "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "indigo" | "purple" | "pink" = "gray";

	/** Badge size */
	@Prop() size: "sm" | "md" = "md";

	/** Whether to show a dot indicator */
	@Prop() dot: boolean = false;

	private getColorClass(): string {
		const colors: Record<string, string> = {
			gray: "bg-surface text-muted border border-muted/45",
			red: "bg-danger/15 text-tdanger border border-tdanger/45",
			orange: "bg-warn/15 text-twarn border border-twarn/45",
			yellow: "bg-warn/25 text-twarn border border-twarn/45",
			green: "bg-success/15 text-tsuccess border border-tsuccess/45",
			teal: "bg-success/20 text-tsuccess border border-tsuccess/45",
			blue: "bg-info/20 text-tinfo border border-tinfo/45",
			indigo: "bg-[#6366f1]/15 text-[#6366f1] border border-[#6366f1]/45",
			purple: "bg-[#8b5cf6]/15 text-[#8b5cf6] border border-[#8b5cf6]/45",
			pink: "bg-[#ec4899]/15 text-[#ec4899] border border-[#ec4899]/45",
		};
		return colors[this.color] || colors.gray;
	}

	private getDotColorClass(): string {
		const colors: Record<string, string> = {
			gray: "bg-muted",
			red: "bg-tdanger",
			orange: "bg-twarn",
			yellow: "bg-twarn",
			green: "bg-tsuccess",
			teal: "bg-tsuccess",
			blue: "bg-tinfo",
			indigo: "bg-[#6366f1]",
			purple: "bg-[#8b5cf6]",
			pink: "bg-[#ec4899]",
		};
		return colors[this.color] || colors.gray;
	}

	render() {
		const sizeClass = this.size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";

		return (
			<span class={`inline-flex items-center gap-1 rounded-full font-text font-medium ${sizeClass} ${this.getColorClass()}`}>
				{this.dot && <span class={`w-1.5 h-1.5 rounded-full ${this.getDotColorClass()}`}></span>}
				<slot></slot>
			</span>
		);
	}
}
