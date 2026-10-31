import { Component, Prop, State, Event, EventEmitter, Watch, Host } from "@stencil/core";
import type { ChatAction, ChatActionDetail, ChatReplyTarget, ChatSubmitDetail } from "@common/types/chat/thread.js";
import { chatText } from "../../../utils/chat-i18n.js";

/** En táctiles, Enter es salto de línea: enviar con el teclado en pantalla es un toque de más fácil de errar. */
function enterSends(): boolean {
	return !globalThis.matchMedia?.("(pointer: coarse)").matches;
}

/**
 * Campo de escritura del chat. Es **controlado**: emite `adcChatInput` con cada cambio y
 * `adcChatSubmit` al enviar, y no se vacía solo (salvo `clearOnSubmit`) — así, si el envío falla,
 * el texto sigue ahí. Enter envía y Shift+Enter hace salto (en táctiles, Enter siempre es salto).
 */
@Component({
	tag: "adc-chat-composer",
	shadow: false,
})
export class AdcChatComposer {
	@Prop() value: string = "";
	@Prop() placeholder?: string;
	@Prop() sendLabel?: string;
	@Prop() disabled: boolean = false;
	/** Envío en curso: el botón muestra el spinner y no se puede reenviar. */
	@Prop() sending: boolean = false;
	@Prop() replyingTo?: ChatReplyTarget;
	/** Botones extra junto al de enviar. */
	@Prop() actions: ChatAction[] = [];
	@Prop() maxLength?: number;
	@Prop() maxRows: number = 6;
	@Prop() clearOnSubmit: boolean = false;

	@State() draft: string = "";

	@Event() adcChatInput!: EventEmitter<{ text: string }>;
	@Event() adcChatSubmit!: EventEmitter<ChatSubmitDetail>;
	@Event() adcChatCancelReply!: EventEmitter<void>;
	@Event() adcChatAction!: EventEmitter<ChatActionDetail>;

	componentWillLoad() {
		this.draft = this.value ?? "";
	}

	@Watch("value")
	onValueChange(next: string) {
		this.draft = next ?? "";
	}

	private readonly onInput = (ev: Event) => {
		const target = ev.target as HTMLTextAreaElement | null;
		if (target?.tagName !== "TEXTAREA") return;
		this.draft = target.value;
		this.adcChatInput.emit({ text: target.value });
	};

	private readonly onKeyDown = (ev: KeyboardEvent) => {
		if (ev.key !== "Enter" || ev.shiftKey || ev.isComposing || !enterSends()) return;
		ev.preventDefault();
		this.submit();
	};

	private readonly onSubmit = (ev: Event) => {
		ev.preventDefault();
		this.submit();
	};

	private submit() {
		const text = this.draft.trim();
		if (!text || this.disabled || this.sending) return;
		this.adcChatSubmit.emit({ text, replyToKey: this.replyingTo?.key });
		if (this.clearOnSubmit) {
			this.draft = "";
			this.adcChatInput.emit({ text: "" });
		}
	}

	render() {
		const placeholder = this.placeholder || chatText("placeholder");
		const canSend = !!this.draft.trim() && !this.disabled && !this.sending;
		return (
			<Host class="block">
				<form class="flex flex-col gap-2" onSubmit={this.onSubmit} aria-label={placeholder}>
					{this.replyingTo && (
						<div class="flex items-center gap-2 rounded-adc bg-surface px-2 py-1 text-xs" role="status">
							<span class="shrink-0 text-muted">{chatText("replyingTo")}</span>
							<span class="min-w-0 flex-1 truncate text-text">{this.replyingTo.preview}</span>
							<button
								type="button"
								class="shrink-0 rounded-full px-1.5 text-muted hover:text-text"
								aria-label={chatText("cancelReply")}
								title={chatText("cancelReply")}
								onClick={() => this.adcChatCancelReply.emit()}
							>
								✕
							</button>
						</div>
					)}
					<div class="flex items-end gap-2" onInput={this.onInput} onKeyDown={this.onKeyDown}>
						<adc-textarea
							class="min-w-0 flex-1"
							rows={1}
							autoGrow
							maxRows={this.maxRows}
							value={this.draft}
							placeholder={placeholder}
							ariaLabel={placeholder}
							disabled={this.disabled}
							maxLength={this.maxLength}
						/>
						{this.actions.map((a) => (
							<adc-button
								key={a.id}
								type="button"
								size="small"
								variant={a.variant === "danger" ? "danger-outlined" : "accent-outlined"}
								label={a.label}
								ariaLabel={a.ariaLabel}
								disabled={a.disabled}
								onClick={() => this.adcChatAction.emit({ scope: "composer", actionId: a.id })}
							/>
						))}
						<adc-button
							type="submit"
							size="small"
							label={this.sendLabel || chatText("send")}
							disabled={!canSend}
							loading={this.sending}
						/>
					</div>
				</form>
			</Host>
		);
	}
}
