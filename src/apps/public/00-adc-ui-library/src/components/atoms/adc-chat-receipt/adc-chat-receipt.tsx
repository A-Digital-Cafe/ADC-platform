import { Component, Prop, State, Host } from "@stencil/core";
import type { ChatReceipt, ChatStatus } from "@common/types/chat/thread.js";
import { chatText, chatTime } from "../../../utils/chat-i18n.js";

const CHECKS: Partial<Record<ChatStatus, string>> = { sent: "✓", read: "✓✓", done: "✓✓" };

/**
 * Hora + estado de un mensaje propio (✓ entregado, ✓✓ leído/respondido). Si trae detalles (qué
 * pasó con el mensaje y cuándo) se despliegan al tocarlo.
 */
@Component({
	tag: "adc-chat-receipt",
	shadow: false,
})
export class AdcChatReceipt {
	/** ISO 8601 del mensaje. */
	@Prop() at: string = "";
	@Prop() status?: ChatStatus;
	@Prop() receipt?: ChatReceipt;

	@State() open = false;

	private readonly toggle = () => {
		this.open = !this.open;
	};

	render() {
		const details = this.receipt?.details ?? [];
		const statusLabel = this.receipt?.label || (this.status ? chatText(`status.${this.status}`) : "");
		const check = this.status ? CHECKS[this.status] : undefined;
		const failed = this.status === "failed";
		const summary = (
			<span class={`inline-flex items-center gap-1 ${failed ? "text-tdanger" : ""}`}>
				<time dateTime={this.at}>{chatTime(this.at)}</time>
				{check && <span aria-hidden="true">{check}</span>}
				{(failed || this.status === "sending" || this.status === "queued") && <span>{statusLabel}</span>}
			</span>
		);
		return (
			<Host class="block text-[11px] text-muted">
				{details.length > 0 ? (
					<button
						type="button"
						class="cursor-pointer hover:underline"
						title={statusLabel}
						aria-label={`${chatTime(this.at)} · ${statusLabel}`}
						aria-expanded={this.open ? "true" : "false"}
						onClick={this.toggle}
					>
						{summary}
					</button>
				) : (
					<span title={statusLabel}>{summary}</span>
				)}
				{this.open && details.length > 0 && (
					<ul class="mt-1 flex list-none flex-col gap-0.5 p-0">
						{details.map((d, i) => (
							<li key={`${i}-${d.text}`}>
								{d.at && (
									<time class="mr-1 tabular-nums" dateTime={d.at}>
										{chatTime(d.at)}
									</time>
								)}
								{d.text}
							</li>
						))}
					</ul>
				)}
			</Host>
		);
	}
}
