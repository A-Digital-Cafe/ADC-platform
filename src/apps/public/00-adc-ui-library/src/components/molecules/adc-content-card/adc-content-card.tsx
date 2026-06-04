import { Component, Prop, Event, EventEmitter } from "@stencil/core";

@Component({
	tag: "adc-content-card",
	shadow: false,
})
export class AdcContentCard {
	@Prop({ attribute: "title" }) cardTitle: string = "";
	@Prop() description?: string;
	@Prop() bannerUrl?: string;
	@Prop() bannerAlt?: string;
	@Prop() href?: string;
	@Prop() compact: boolean = false;

	@Event() cardClick!: EventEmitter<MouseEvent>;

	private readonly handleClick = (event: MouseEvent) => {
		this.cardClick.emit(event);
	};

	private readonly handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			this.handleClick(event as unknown as MouseEvent);
		}
	};

	render() {
		const rootClass = "relative block h-full rounded-xxl cursor-pointer no-underline group max-w-lg";
		const surfaceClass =
			"absolute inset-0 min-h-full bg-surface shadow-cozy custom-surface rounded-xxl " +
			"motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out " +
			"group-hover:scale-y-[1.05]";

		const innerClass = "relative p-4 pb-5 text-text space-y-2 min-h-full flex flex-col justify-start";

		const imageClass = `w-full object-cover rounded-xxl ${this.compact ? "h-24" : "h-40"}`;

		const content = (
			<div class={innerClass}>
				{this.bannerUrl && <img src={this.bannerUrl} alt={this.bannerAlt || this.cardTitle} class={imageClass} loading="lazy" />}
				{this.description && <h2 class="text-lg font-semibold">{this.cardTitle}</h2>}
				{!this.description && <h3 class="text-lg font-semibold">{this.cardTitle}</h3>}
				{this.description && <p>{this.description}</p>}
				<slot></slot>
			</div>
		);

		if (this.href) {
			return (
				<a href={this.href} class={rootClass} onClick={this.handleClick}>
					<div class={surfaceClass}></div>
					{content}
				</a>
			);
		}

		return (
			<div class={rootClass} role="button" tabIndex={0} onClick={this.handleClick} onKeyDown={this.handleKeyDown}>
				<div class={surfaceClass}></div>
				{content}
			</div>
		);
	}
}
