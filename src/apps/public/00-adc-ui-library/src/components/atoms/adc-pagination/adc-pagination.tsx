import { Component, Prop, Event, EventEmitter } from "@stencil/core";

@Component({
	tag: "adc-pagination",
	shadow: false,
})
export class AdcPagination {
	/** Current page (1-indexed) */
	@Prop() currentPage: number = 1;

	/** Total number of pages */
	@Prop() totalPages: number = 1;

	/** Max visible page buttons */
	@Prop() maxVisible: number = 5;

	@Event() adcPageChange!: EventEmitter<number>;

	private readonly handlePage = (page: number) => {
		if (page < 1 || page > this.totalPages || page === this.currentPage) return;
		this.adcPageChange.emit(page);
	};

	private getVisiblePages(): (number | "...")[] {
		const total = this.totalPages;
		const current = this.currentPage;
		const max = this.maxVisible;

		if (total <= max) {
			return Array.from({ length: total }, (_, i) => i + 1);
		}

		const pages: (number | "...")[] = [];
		const half = Math.floor(max / 2);

		let start = Math.max(2, current - half);
		let end = Math.min(total - 1, current + half);

		if (current <= half + 1) {
			end = max - 1;
		}
		if (current >= total - half) {
			start = total - max + 2;
		}

		pages.push(1);
		if (start > 2) pages.push("...");

		for (let i = start; i <= end; i++) {
			pages.push(i);
		}

		if (end < total - 1) pages.push("...");
		pages.push(total);

		return pages;
	}

	render() {
		if (this.totalPages <= 1) return null;

		const pages = this.getVisiblePages();

		const btnBase =
			"min-h-[36px] min-w-[36px] px-2 py-1 rounded-xxl font-text text-sm transition-colors touch-manipulation flex items-center justify-center";
		const btnActive = "bg-primary text-tprimary font-semibold shadow-cozy";
		const btnInactive = "text-muted hover:bg-surface hover:text-text cursor-pointer";
		const btnDisabled = "opacity-30 cursor-not-allowed";

		return (
			<nav class="flex items-center gap-1" aria-label="Pagination">
				{/* Previous */}
				<button
					type="button"
					class={`${btnBase} ${this.currentPage <= 1 ? btnDisabled : btnInactive}`}
					onClick={() => this.handlePage(this.currentPage - 1)}
					disabled={this.currentPage <= 1}
					aria-label="Previous page"
				>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M15 18l-6-6 6-6" />
					</svg>
				</button>

				{/* Page buttons */}
				{pages.map((page) => {
					if (page === "...") {
						return (
							<span key={`page-${page}`} class={`${btnBase} text-muted`}>
								…
							</span>
						);
					}

					const isActive = page === this.currentPage;
					return (
						<button
							type="button"
							key={`page-${page}`}
							class={`${btnBase} ${isActive ? btnActive : btnInactive}`}
							onClick={() => this.handlePage(page)}
							aria-current={isActive ? "page" : undefined}
							aria-label={`Page ${page}`}
						>
							{page}
						</button>
					);
				})}

				{/* Next */}
				<button
					type="button"
					class={`${btnBase} ${this.currentPage >= this.totalPages ? btnDisabled : btnInactive}`}
					onClick={() => this.handlePage(this.currentPage + 1)}
					disabled={this.currentPage >= this.totalPages}
					aria-label="Next page"
				>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M9 18l6-6-6-6" />
					</svg>
				</button>
			</nav>
		);
	}
}
