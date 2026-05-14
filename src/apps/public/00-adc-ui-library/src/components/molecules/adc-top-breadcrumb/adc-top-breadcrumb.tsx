import { Component, Prop, Event, EventEmitter } from "@stencil/core";

export interface BreadcrumbItem {
	label: string;
	href?: string;
}

/**
 * Top-of-page breadcrumb with integrated back button.
 *
 * Usage:
 *   <adc-top-breadcrumb
 *     items='[{"label":"Learning Paths","href":"/paths"},{"label":"Mi Path"}]'
 *     back-label="Volver" />
 *
 * Emits `adcBack` when the back button is clicked; if `backHref` is provided
 * and no listener handles it, the component navigates via anchor.
 */
@Component({
	tag: "adc-top-breadcrumb",
	shadow: false,
})
export class AdcTopBreadcrumb {
	/** Breadcrumb items (last one is current page, no link). Array or JSON string. */
	@Prop() items: BreadcrumbItem[] | string = [];

	/** Accessible label for the back button */
	@Prop() backLabel: string = "Volver";

	/** If set, back button acts as a link to this href (fallback when no event listener) */
	@Prop() backHref?: string;

	@Event() adcBack!: EventEmitter<void>;

	private get parsedItems(): BreadcrumbItem[] {
		if (typeof this.items === "string") {
			try {
				return JSON.parse(this.items);
			} catch {
				return [];
			}
		}
		return this.items || [];
	}

	private readonly handleBack = (e: MouseEvent) => {
		if (!this.backHref) e.preventDefault();
		this.adcBack.emit();
	};

	private readonly handleItemClick = (e: MouseEvent, href?: string) => {
		if (!href) return;
		// Deja que los consumidores intercepten con su router si quieren.
		// Si no hay handler, navegación nativa del <a> funciona igual.
		e.stopPropagation();
	};

	private static readonly keyPrefix = "breadcrumb-item-";

	render() {
		const items = this.parsedItems;

		return (
			<div class="flex items-center gap-2 mb-4">
				<adc-button class="p-2 mr-2" aria-label={this.backLabel} onClick={this.handleBack}>
					<adc-icon-left-arrow />
					<span class="sr-only">{this.backLabel}</span>
				</adc-button>

				<nav aria-label="breadcrumb">
					<ol class="flex flex-wrap items-center breadcumb">
						{items.map((item, idx) => {
							const isLast = idx === items.length - 1;
							if (isLast || !item.href) {
								return (
									<li key={AdcTopBreadcrumb.keyPrefix + idx} aria-current={isLast ? "page" : undefined}>
										{item.label}
									</li>
								);
							}
							return (
								<li key={AdcTopBreadcrumb.keyPrefix + idx}>
									<a href={item.href} onClick={(e) => this.handleItemClick(e, item.href)}>
										{item.label}
									</a>
								</li>
							);
						})}
					</ol>
				</nav>
			</div>
		);
	}
}
