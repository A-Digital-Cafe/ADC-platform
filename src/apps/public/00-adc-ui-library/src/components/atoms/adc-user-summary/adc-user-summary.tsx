import { Component, Prop } from "@stencil/core";

@Component({
	tag: "adc-user-summary",
	shadow: false,
})
export class AdcUserSummary {
	@Prop() username: string = "";
	@Prop() email?: string;

	render() {
		const displayName = this.username?.trim() || this.email?.trim() || "";

		return (
			<div class="min-w-0">
				<span class="text-sm font-medium text-text">{displayName}</span>
				{this.email && <span class="text-xs text-muted ml-2">{this.email}</span>}
			</div>
		);
	}
}
