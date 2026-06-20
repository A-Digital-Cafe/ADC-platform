import { Component, Prop, Host } from "@stencil/core";

let textareaUid = 0;

@Component({
	tag: "adc-textarea",
	shadow: false,
})
export class AdcTextarea {
	@Prop() value: string = "";
	@Prop() placeholder?: string = "";
	@Prop() textareaId?: string = "";
	@Prop() name?: string = "";
	@Prop() rows?: number = 3;
	@Prop() ariaLabel?: string = "";
	@Prop() disabled?: boolean = false;
	/** Marca el campo como requerido en su formulario. */
	@Prop() required?: boolean = false;
	/** Cantidad máxima de caracteres. */
	@Prop() maxLength?: number;
	/** Mensaje de error inline; activa el estado inválido (borde danger + aria-invalid). */
	@Prop() error?: string;
	/** Marca el campo como inválido sin texto. */
	@Prop() invalid?: boolean = false;
	/** Texto de ayuda neutro bajo el campo. Se ignora si hay `error`. */
	@Prop() hint?: string;

	private readonly uid = `adc-textarea-${textareaUid++}`;

	private get isInvalid(): boolean {
		return this.invalid || !!this.error;
	}

	private get messageId(): string | undefined {
		if (!this.error && !this.hint) return undefined;
		return `${this.textareaId || this.name || this.uid}-msg`;
	}

	private renderMessage(messageId: string | undefined) {
		if (this.error) {
			return (
				<span id={messageId} role="alert" class="mt-1 block font-text text-[11px] text-danger">
					{this.error}
				</span>
			);
		}
		if (this.hint) {
			return (
				<span id={messageId} class="mt-1 block font-text text-[11px] text-muted">
					{this.hint}
				</span>
			);
		}
		return null;
	}

	render() {
		const messageId = this.messageId;
		return (
			<Host class="block">
				<textarea
					id={this.textareaId}
					name={this.name}
					placeholder={this.placeholder}
					rows={this.rows}
					disabled={this.disabled}
					required={this.required}
					maxlength={this.maxLength}
					aria-label={this.ariaLabel || this.placeholder || this.name}
					aria-invalid={this.isInvalid ? "true" : undefined}
					aria-describedby={messageId}
					class={`w-full px-3 py-2 rounded-xxl border bg-surface font-text text-[12px] text-text resize-y disabled:opacity-50 disabled:cursor-not-allowed ${this.isInvalid ? "border-danger" : "border-text/15"}`}
				>
					{this.value}
				</textarea>
				{this.renderMessage(messageId)}
			</Host>
		);
	}
}
