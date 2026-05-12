import { Component, Prop, h, Event, EventEmitter } from "@stencil/core";

/**
 * Tarjeta genérica para boards de tipo Kanban. Es un contenedor visual:
 * - header: slot `header` (ej. key + categoría)
 * - title: prop o slot `title`
 * - content extra: slot default (ej. priority-indicator, custom fields)
 * - footer: slot `footer` (ej. assignees, storyPoints)
 *
 * Se puede marcar como `muted` para efectos de focus-mode (ver fase 5).
 */
@Component({
	tag: "adc-kanban-card",
	shadow: false,
})
export class AdcKanbanCard {
	@Prop() cardTitle?: string;
	@Prop() clickable: boolean = true;
	/** Si es true, baja opacidad + grayscale (focus mode) */
	@Prop() muted: boolean = false;
	/** Borde izquierdo de color (ej. color de columna o categoría) */
	@Prop() accentColor?: string;
	/** Si es true, aplica estilo de "está siendo arrastrada" */
	@Prop() dragging: boolean = false;
	/** Habilita draggable HTML5 */
	@Prop() isDraggable: boolean = false;

	@Event() cardClick!: EventEmitter<MouseEvent | KeyboardEvent>;

	private readonly handleClick = (event: MouseEvent) => {
		if (!this.clickable) return;
		this.cardClick.emit(event);
	};

	private readonly handleKeyDown = (event: KeyboardEvent) => {
		if (!this.clickable) return;
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			this.cardClick.emit(event);
		}
	};

	render() {
		const mutedCls = this.muted ? "opacity-40 grayscale" : "";
		const draggingCls = this.dragging ? "opacity-50 scale-[0.98]" : "";
		const cursorCls = this.clickable ? "cursor-pointer" : "";
		const accentStyle = this.accentColor ? { borderLeftColor: this.accentColor, borderLeftWidth: "3px" } : {};
		const role = this.clickable ? "button" : undefined;
		const tabIndex = this.clickable ? 0 : undefined;

		return (
			<div
				class={`relative block rounded-lg bg-surface border border-border shadow-sm p-3 space-y-1.5 hover:shadow-md transition-shadow ${cursorCls} ${mutedCls} ${draggingCls}`}
				style={accentStyle}
				role={role}
				tabIndex={tabIndex}
				draggable={this.isDraggable}
				onClick={this.handleClick}
				onKeyDown={this.handleKeyDown}
			>
				<div class="flex items-center justify-between gap-2 text-[10px] font-mono text-muted">
					<slot name="header"></slot>
				</div>
				{this.cardTitle && <h4 class="text-sm font-medium text-text leading-snug line-clamp-2">{this.cardTitle}</h4>}
				<slot name="title"></slot>
				<slot></slot>
				<div class="flex items-center justify-between gap-2">
					<slot name="footer"></slot>
				</div>
			</div>
		);
	}
}
