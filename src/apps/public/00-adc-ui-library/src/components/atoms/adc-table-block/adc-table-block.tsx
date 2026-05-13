import { Component, Prop, h } from "@stencil/core";

@Component({
	tag: "adc-table-block",
	shadow: false,
})
export class AdcTableBlock {
	@Prop() header: string[] = [];
	@Prop() rows: string[][] = [];
	@Prop() columnAlign?: Array<"left" | "center" | "right">;
	@Prop() caption?: string;
	@Prop() rowHeaders: boolean = false;
	private static readonly keyPrefix = "table-";

	private getAlignClass(align?: "left" | "center" | "right"): string {
		if (align === "center") return "text-center";
		if (align === "right") return "text-right";
		return "text-left";
	}

	render() {
		return (
			<div class="overflow-x-auto my-3">
				<table class="min-w-[50vw] ml-8 border-collapse xl:max-w-[80vw]">
					{this.caption && <caption class="text-left text-sm text-text opacity-80 mb-1">{this.caption}</caption>}
					<thead>
						<tr>
							{this.header.map((headerCell, i) => (
								<th
									key={AdcTableBlock.keyPrefix + "header-" + i}
									class={`border-b border-surface px-2 py-1 text-left ${this.getAlignClass(this.columnAlign?.[i])}`}
								>
									<adc-inline-tokens tokens={[]} fallback={headerCell}></adc-inline-tokens>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{this.rows.map((row, ri) => (
							<tr key={AdcTableBlock.keyPrefix + "row-" + ri} class={ri % 2 === 0 ? "odd:bg-primary" : "even:bg-white/60"}>
								{row.map((cell, ci) => {
									if (this.rowHeaders && ci === 0) {
										return (
											<th
												key={AdcTableBlock.keyPrefix + "row-" + ri + "-cell-" + ci}
												scope="row"
												class="border-b border-surface px-2 py-1 text-left font-medium"
											>
												<adc-inline-tokens tokens={[]} fallback={cell}></adc-inline-tokens>
											</th>
										);
									}
									return (
										<td
											key={AdcTableBlock.keyPrefix + "row-" + ri + "-cell-" + ci}
											class={`border-b border-surface px-2 py-1 ${this.getAlignClass(this.columnAlign?.[ci])}`}
										>
											<adc-inline-tokens tokens={[]} fallback={cell}></adc-inline-tokens>
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}
}
