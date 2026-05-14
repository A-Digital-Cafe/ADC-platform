import { Component, Prop, Event, EventEmitter, Listen, Element, Host } from "@stencil/core";

@Component({
	tag: "adc-modal",
	shadow: false,
})
export class AdcModal {
	@Element() el!: HTMLElement;

	/** Whether the modal is visible */
	@Prop({ mutable: true, reflect: true }) open: boolean = false;

	/** Modal title */
	@Prop() modalTitle: string = "";

	/** Size variant */
	@Prop() size: "sm" | "md" | "lg" | "xl" = "md";

	/** Whether clicking the backdrop closes the modal */
	@Prop() dismissOnBackdrop: boolean = true;

	/** Whether pressing Escape closes the modal */
	@Prop() dismissOnEscape: boolean = true;

	@Event() adcClose!: EventEmitter<void>;

	@Listen("keydown", { target: "window" })
	handleKeyDown(event: KeyboardEvent) {
		if (this.open && this.dismissOnEscape && event.key === "Escape") {
			this.close();
		}
	}

	private readonly close = () => {
		this.open = false;
		this.adcClose.emit();
	};

	private getSizeClass(): string {
		switch (this.size) {
			case "sm":
				return "max-w-sm";
			case "lg":
				return "max-w-2xl";
			case "xl":
				return "max-w-6xl";
			default:
				return "max-w-lg";
		}
	}

	render() {
		const backdropClass = "absolute inset-0 w-full h-full bg-black/50 backdrop-blur-sm";

		return (
			<Host style={{ visibility: "inherit" }}>
				{this.open && (
					<dialog
						open
						class="fixed inset-0 z-50 text-text p-0 m-0 border-none w-full h-full max-w-none max-h-none bg-transparent animate-[fadeIn_0.15s_ease-out]"
						aria-modal="true"
						aria-label={this.modalTitle}
					>
						{this.dismissOnBackdrop ? (
							<button type="button" class={`${backdropClass} cursor-default`} onClick={this.close} aria-label="Cerrar modal" />
						) : (
							<div class={backdropClass} aria-hidden="true" />
						)}
						<div class="relative z-10 flex min-h-full w-full items-center justify-center p-4 pointer-events-none">
							<div
								class={`${this.getSizeClass()} pointer-events-auto w-full bg-background/75 border border-surface rounded-xxl shadow-cozy animate-[scaleIn_0.15s_ease-out] max-h-[90vh] overflow-y-auto`}
							>
								{/* Header */}
								{this.modalTitle && (
									<div class="flex items-center justify-between px-6 py-4 bg-header/75 border-b border-surface">
										<h2 class="font-heading text-lg font-semibold text-text">{this.modalTitle}</h2>
										<button
											type="button"
											class="p-1 rounded-full hover:bg-surface transition-colors min-h-11 min-w-11 touch-manipulation flex items-center justify-center"
											onClick={this.close}
											aria-label="Cerrar"
										>
											<svg class="w-5 h-5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<path d="M18 6L6 18M6 6l12 12" />
											</svg>
										</button>
									</div>
								)}

								{/* Body */}
								<div class="px-6 py-4">
									<slot></slot>
								</div>

								{/* Footer (optional slot) */}
								<div class="px-6 py-3 bg-header/75 border-t border-surface flex justify-end gap-2">
									<slot name="footer"></slot>
								</div>
							</div>
						</div>
					</dialog>
				)}
			</Host>
		);
	}
}
