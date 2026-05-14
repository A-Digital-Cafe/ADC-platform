import { Component, Prop } from "@stencil/core";

@Component({
	tag: "adc-list-block",
	shadow: false,
})
export class AdcListBlock {
	@Prop() ordered: boolean = false;
	@Prop() items: string[] = [];
	@Prop() start?: number;
	@Prop() ariaLabel?: string;
	private static readonly keyPrefix = "list-item-";

	render() {
		const listClass = "pl-5 my-2 list-outside mb-2 ml-16";
		const listItems = this.items.map((item, index) => (
			<li key={AdcListBlock.keyPrefix + index}>
				<adc-inline-tokens tokens={[]} fallback={item}></adc-inline-tokens>
			</li>
		));

		if (this.ordered) {
			return (
				<ol class={`${listClass} list-decimal`} start={this.start} aria-label={this.ariaLabel}>
					{listItems}
				</ol>
			);
		}

		return (
			<ul class={`${listClass} list-disc`} aria-label={this.ariaLabel}>
				{listItems}
			</ul>
		);
	}
}
