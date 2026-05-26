import { Component, Host, Prop } from "@stencil/core";

@Component({
	tag: "adc-section-panel",
	shadow: false,
})
export class AdcSectionPanel {
	/** Optional panel heading. */
	@Prop() heading: string = "";

	/** Optional panel description. */
	@Prop() description?: string;

	/** Optional max width for the slotted content. */
	@Prop() contentWidth: "none" | "md" | "lg" = "none";

	private getContentClass(): string {
		switch (this.contentWidth) {
			case "md":
				return "max-w-2xl mx-auto";
			case "lg":
				return "max-w-3xl mx-auto";
			default:
				return "";
		}
	}

	render() {
		const hasHeader = Boolean(this.heading || this.description);
		const contentClass = this.getContentClass();

		return (
			<Host class="block bg-surface p-8 pb-6 rounded-xxl">
				{hasHeader && (
					<div class="mb-6">
						{this.heading && <h3 class="mt-0! text-lg font-semibold text-text">{this.heading}</h3>}
						{this.description && <p class="text-sm text-muted">{this.description}</p>}
					</div>
				)}
				<div class={contentClass}>
					<slot></slot>
				</div>
			</Host>
		);
	}
}
