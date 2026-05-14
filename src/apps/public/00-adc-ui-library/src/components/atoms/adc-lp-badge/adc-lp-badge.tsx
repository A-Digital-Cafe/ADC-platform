import { Component, Prop, Event, EventEmitter } from "@stencil/core";

@Component({
	tag: "adc-lp-badge",
	shadow: false,
})
export class AdcLpBadge {
	@Prop() title: string = "";
	@Prop() color: string = "";
	@Prop() slug?: string;
	@Prop() as?: "button" | "span";

	@Event() adcClick!: EventEmitter<void>;

	private readonly handleClick = () => {
		this.adcClick.emit();
	};

	private getColorClasses(): string {
		const colorMap = new Map([
			["red", "bg-red-100 text-red-700 border-red-600"],
			["orange", "bg-orange-100 text-orange-700 border-orange-600"],
			["yellow", "bg-yellow-100 text-yellow-700 border-yellow-600"],
			["green", "bg-green-100 text-green-700 border-green-600"],
			["teal", "bg-teal-100 text-teal-700 border-teal-600"],
			["blue", "bg-blue-100 text-blue-700 border-blue-600"],
			["purple", "bg-purple-100 text-purple-700 border-purple-600"],
			["pink", "bg-pink-100 text-pink-700 border-pink-600"],
		]);
		return colorMap.get(this.color) ?? "";
	}

	render() {
		const baseClass = `px-2 py-1 min-w-fit rounded-full border text-sm no-underline inline-block flex items-center ${this.getColorClasses()}`;

		if (this.slug) {
			return (
				<a href={`/paths/${this.slug}`} class={baseClass}>
					{this.title}
				</a>
			);
		}

		if (this.as === "button") {
			return (
				<button type="button" class={baseClass} onClick={this.handleClick}>
					{this.title}
				</button>
			);
		}

		return <span class={baseClass}>{this.title}</span>;
	}
}
