import { Component, Host, Prop } from "@stencil/core";

@Component({
	tag: "adc-page-shell",
	shadow: false,
})
export class AdcPageShell {
	/** Main page heading. */
	@Prop() heading: string = "";

	/** Optional text rendered below the heading. */
	@Prop() description?: string;

	/** Matches app pages that sit beside the shared sidebar. */
	@Prop() sidebarOffset: boolean = true;

	/** Spacing below the heading block. */
	@Prop() headerSpacing: "sm" | "md" = "md";

	render() {
		const rootClass = `h-full w-full flex flex-col ${this.sidebarOffset ? "pl-25 lg:pl-70" : ""}`.trim();
		const headerClass = this.headerSpacing === "sm" ? "mb-4" : "mb-6";
		const hasHeader = Boolean(this.heading || this.description);

		return (
			<Host class={rootClass}>
				{hasHeader && (
					<div class={headerClass}>
						{this.heading && <h2 class="font-heading text-2xl font-bold text-text mb-2">{this.heading}</h2>}
						{this.description && <p class="text-muted">{this.description}</p>}
					</div>
				)}
				<slot></slot>
			</Host>
		);
	}
}
