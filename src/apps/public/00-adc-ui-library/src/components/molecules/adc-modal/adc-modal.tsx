import { Component, Prop, Event, EventEmitter, Listen, Element, Host, Watch } from "@stencil/core";

/**
 * Modales abiertos en la página. El scroll del fondo se bloquea mientras haya
 * al menos uno: si no, se ven dos barras de scroll (la del fondo y la del
 * contenido del modal) y la rueda scrollea la página de atrás.
 *
 * ⚠️ El panel se centra con `position: fixed`, así que **cualquier ancestro con `transform`,
 * `filter`, `backdrop-filter`, `perspective`, `will-change` o `contain` lo captura**: pasa a
 * centrarse sobre ese ancestro y, con el scroll del fondo bloqueado, en un contenedor alto queda
 * fuera de vista. El caso conocido es el vidrio del tema `crystal` sobre `.bg-surface` (una
 * `adc-card`), neutralizado en `global/tailwind.css` mientras la superficie contiene un modal
 * abierto — de ahí que `open` se refleje como atributo. Si aparece otro, se resuelve igual: no hay
 * forma en CSS de que un `fixed` escape de su containing block.
 */
let openModalCount = 0;

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

	/** Size variant (`full` = pantalla completa, para editores y vistas de trabajo) */
	@Prop() size: "sm" | "md" | "lg" | "lg2" | "xl" | "full" = "md";

	/**
	 * Oculta la cabecera y el pie del modal: el host provee su propia barra
	 * (útil con `size="full"`, donde una cabecera genérica duplicaría el título
	 * que ya muestra el contenido). `modalTitle` se sigue usando como `aria-label`.
	 */
	@Prop() hideChrome: boolean = false;

	/** Whether clicking the backdrop closes the modal */
	@Prop() dismissOnBackdrop: boolean = true;

	/** Whether pressing Escape closes the modal */
	@Prop() dismissOnEscape: boolean = true;

	@Event() adcClose!: EventEmitter<void>;

	/** Si este modal es el que tiene tomado el bloqueo de scroll del fondo. */
	private scrollLocked = false;

	componentDidLoad() {
		this.syncScrollLock();
	}

	@Watch("open")
	onOpenPropChange() {
		this.syncScrollLock();
	}

	disconnectedCallback() {
		this.releaseScrollLock();
	}

	/** Bloquea/libera el scroll del documento de fondo según `open`. */
	private syncScrollLock() {
		if (this.open === this.scrollLocked) return;
		if (this.open) {
			this.scrollLocked = true;
			openModalCount += 1;
		} else {
			this.releaseScrollLock();
			return;
		}
		AdcModal.applyScrollLock();
	}

	private releaseScrollLock() {
		if (!this.scrollLocked) return;
		this.scrollLocked = false;
		openModalCount = Math.max(0, openModalCount - 1);
		AdcModal.applyScrollLock();
	}

	private static applyScrollLock() {
		const value = openModalCount > 0 ? "hidden" : "";
		// `html` y `body`: según la app, el scroll del viewport vive en uno u otro.
		document.documentElement.style.overflow = value;
		document.body.style.overflow = value;
	}

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
			case "lg2":
				return "max-w-3xl";
			case "xl":
				return "max-w-6xl";
			case "full":
				return "max-w-none";
			default:
				return "max-w-lg";
		}
	}

	render() {
		const backdropClass = "absolute inset-0 w-full h-full bg-black/50 backdrop-blur-sm";
		const full = this.size === "full";
		// En pantalla completa el panel ocupa el viewport y el scroll vive en
		// el cuerpo (así las barras del host quedan fijas arriba/abajo).
		// A pantalla completa el panel es opaco: no hay contexto detrás que valga
		// la pena dejar ver y el contenido debe leerse sin interferencias.
		const panelClass = full
			? "h-full rounded-none border-0 flex flex-col overflow-hidden bg-background"
			: "rounded-xxl max-h-[90vh] overflow-y-auto bg-background/75";
		const bodyClass = [full ? "flex-1 min-h-0 overflow-y-auto" : "", this.hideChrome ? "" : "px-6 py-4"].filter(Boolean).join(" ");
		const showChrome = !this.hideChrome;

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
						<div class={`relative z-10 flex min-h-full w-full items-center justify-center pointer-events-none ${full ? "h-full" : "p-4"}`}>
							<div
								class={`${this.getSizeClass()} ${panelClass} pointer-events-auto w-full border border-surface shadow-cozy animate-[scaleIn_0.15s_ease-out]`}
							>
								{/* Header */}
								{showChrome && this.modalTitle && (
									<div class="flex items-center justify-between px-6 py-4 bg-header/75 border-b border-surface">
										<h2 class="font-heading text-lg font-semibold text-text">{this.modalTitle}</h2>
										<button
											type="button"
											class="p-1 rounded-full hover:bg-surface transition-colors min-h-11 min-w-11 touch-manipulation flex items-center justify-center"
											onClick={this.close}
											aria-label="Cerrar"
										>
											<svg
												class="w-5 h-5 text-muted"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
											>
												<path d="M18 6L6 18M6 6l12 12" />
											</svg>
										</button>
									</div>
								)}

								{/* Body */}
								<div class={bodyClass}>
									<slot></slot>
								</div>

								{/* Footer (optional slot) */}
								{showChrome && (
									<div class="px-6 py-3 bg-header/75 border-t border-surface flex justify-end gap-2">
										<slot name="footer"></slot>
									</div>
								)}
							</div>
						</div>
					</dialog>
				)}
			</Host>
		);
	}
}
