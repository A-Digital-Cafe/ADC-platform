import { Component, Prop, Event, EventEmitter, Host, JSX } from "@stencil/core";
import type {
	ChatAction,
	ChatActionDetail,
	ChatBlock,
	ChatItem,
	ChatPart,
	ChatQuoteDetail,
	ChatReactionDetail,
	ChatSuggestionDetail,
	ChatTone,
} from "@common/types/chat/thread.js";
import { chatTime } from "../../../utils/chat-i18n.js";

const TONE_CLASS: Record<ChatTone, string> = {
	neutral: "bg-surface text-muted border border-muted/45",
	info: "bg-info/20 text-tinfo border border-tinfo/45",
	success: "bg-success/15 text-tsuccess border border-tsuccess/45",
	warning: "bg-warn/15 text-twarn border border-twarn/45",
	danger: "bg-danger/15 text-tdanger border border-tdanger/45",
};

const ACTION_CLASS: Record<NonNullable<ChatAction["variant"]>, string> = {
	default: "rounded-full border border-current/30 px-2.5 py-0.5 hover:bg-current/10",
	primary: "rounded-full border border-transparent bg-accent px-2.5 py-0.5 text-tprimary hover:opacity-90",
	danger: "rounded-full border border-transparent bg-danger px-2.5 py-0.5 text-tdanger hover:opacity-90",
	link: "underline-offset-2 hover:underline opacity-80 hover:opacity-100",
};

/**
 * Un mensaje del chat: autor, meta, una o más burbujas (`parts`) con bloques, sugerencias y
 * reacciones, y acciones del mensaje. No guarda estado propio: todo lo interactivo sale como
 * evento `adcChat*` y la app decide qué significa cada `id`.
 */
@Component({
	tag: "adc-chat-message",
	shadow: false,
})
export class AdcChatMessage {
	@Prop() item!: ChatItem;
	/** Sigue a otro mensaje del mismo autor: sin avatar ni nombre. */
	@Prop() continued: boolean = false;
	/** Resaltado momentáneo (el destino de una cita). */
	@Prop() highlighted: boolean = false;

	@Event() adcChatAction!: EventEmitter<ChatActionDetail>;
	@Event() adcChatSuggestion!: EventEmitter<ChatSuggestionDetail>;
	@Event() adcChatReaction!: EventEmitter<ChatReactionDetail>;
	@Event() adcChatQuoteClick!: EventEmitter<ChatQuoteDetail>;

	private emitAction(actionId: string, partKey?: string) {
		this.adcChatAction.emit({ scope: partKey ? "part" : "item", itemKey: this.item.key, partKey, actionId });
	}

	private renderActionButton(action: ChatAction, onClick: () => void) {
		const variant = action.variant ?? "default";
		const pressed = action.pressed === undefined ? undefined : action.pressed ? "true" : "false";
		return (
			<button
				key={action.id}
				type="button"
				class={`text-xs ${ACTION_CLASS[variant]} ${action.pressed ? "bg-accent/20 border-accent" : ""} disabled:cursor-not-allowed disabled:opacity-50`}
				title={action.ariaLabel}
				aria-label={action.ariaLabel}
				aria-pressed={pressed}
				disabled={action.disabled}
				onClick={onClick}
			>
				{action.label}
			</button>
		);
	}

	/** `partKey` es el de la burbuja (vuelve en los eventos); `prefix` sólo arma claves únicas del vdom en bloques anidados. */
	private renderBlock(block: ChatBlock, partKey: string, index: number, prefix: string = partKey): JSX.Element | null {
		const key = `${prefix}-${index}`;
		switch (block.type) {
			case "text":
			case "paragraph":
				return (
					<p key={key} class="m-0 whitespace-pre-wrap break-words">
						{block.text}
					</p>
				);
			case "heading":
				return (
					<p key={key} class="m-0 font-heading font-semibold">
						{block.text}
					</p>
				);
			case "quote":
				return (
					<blockquote key={key} class="m-0 border-l-2 border-current/40 pl-2 opacity-90 whitespace-pre-wrap">
						{block.text}
					</blockquote>
				);
			case "code":
				return (
					<pre key={key} class="m-0 overflow-x-auto rounded-adc bg-background/60 p-2 text-xs">
						<code>{block.text}</code>
					</pre>
				);
			case "list": {
				const items = block.items.map((text, i) => <li key={`${key}-${i}`}>{text}</li>);
				return block.ordered ? (
					<ol key={key} class="m-0 list-decimal pl-5">
						{items}
					</ol>
				) : (
					<ul key={key} class="m-0 list-disc pl-5">
						{items}
					</ul>
				);
			}
			case "chips":
				return (
					<div key={key} class="flex flex-wrap gap-1">
						{block.items.map((chip, i) => (
							<span
								key={`${key}-${i}`}
								title={chip.title}
								class={`rounded-full px-2 py-0.5 text-[11px] ${TONE_CLASS[chip.tone ?? "neutral"]}`}
							>
								{chip.label}
							</span>
						))}
					</div>
				);
			case "actions":
				return (
					<div key={key} class="flex flex-wrap gap-1.5">
						{block.actions.map((a) => this.renderActionButton(a, () => this.emitAction(a.id, partKey)))}
					</div>
				);
			case "disclosure":
				return (
					<details key={block.key} open={block.open} class="rounded-adc">
						<summary class="cursor-pointer text-xs opacity-80 hover:opacity-100">{block.summary}</summary>
						<div class="mt-1 flex flex-col gap-1.5 text-xs">
							{block.blocks.map((b, i) => this.renderBlock(b, partKey, i, `${key}-${block.key}`))}
						</div>
					</details>
				);
			case "card":
				return (
					<div key={key} class={`flex flex-col gap-1.5 rounded-adc p-2 text-xs ${TONE_CLASS[block.tone ?? "neutral"]}`}>
						{block.title && <p class="m-0 font-semibold">{block.title}</p>}
						{block.blocks.map((b, i) => this.renderBlock(b, partKey, i, `${key}-card`))}
						{block.actions && block.actions.length > 0 && (
							<div class="flex flex-wrap gap-1.5">
								{block.actions.map((a) => this.renderActionButton(a, () => this.emitAction(a.id, partKey)))}
							</div>
						)}
					</div>
				);
			default:
				return null;
		}
	}

	private bubbleClass(part: ChatPart): string {
		const self = this.item.side === "self";
		let tone = self ? "bg-primary text-tprimary" : "bg-surface text-text shadow-cozy";
		if (part.variant === "error") tone = "bg-danger/15 text-tdanger border border-tdanger/45";
		else if (part.variant === "muted") tone = self ? "bg-primary/60 text-tprimary" : "bg-surface/60 text-muted";
		const emphasis = part.variant === "emphasis" ? " italic" : "";
		let highlight = "";
		if (part.highlight === "invite") highlight = " ring-2 ring-accent";
		else if (part.highlight === "pulse") highlight = " ring-2 ring-accent animate-[pulse_1.2s_ease-in-out_3] motion-reduce:animate-none";
		return `flex max-w-full flex-col gap-1.5 rounded-xxl px-3 py-2 text-sm ${tone}${emphasis}${highlight}`;
	}

	private renderPart(part: ChatPart) {
		const itemKey = this.item.key;
		const align = this.item.side === "self" ? "items-end" : "items-start";
		return (
			<div key={part.key} class={`flex w-full flex-col gap-1 ${align}`} data-chat-part={part.key}>
				<div class={this.bubbleClass(part)}>{part.blocks.map((b, i) => this.renderBlock(b, part.key, i))}</div>
				{part.suggestions && part.suggestions.length > 0 && (
					<div class="flex flex-wrap gap-1.5" role="group">
						{part.suggestions.map((s) => (
							<button
								key={s.id}
								type="button"
								class="rounded-full border border-accent/50 bg-transparent px-3 py-1 text-xs text-accent hover:bg-accent/10"
								onClick={() => this.adcChatSuggestion.emit({ itemKey, partKey: part.key, id: s.id, value: s.value ?? s.label })}
							>
								{s.label}
							</button>
						))}
					</div>
				)}
				{part.reactions && part.reactions.length > 0 && (
					<div class="flex flex-wrap items-center gap-1 text-muted">
						{part.reactions.map((r) =>
							this.renderActionButton(r, () =>
								this.adcChatReaction.emit({ itemKey, partKey: part.key, id: r.id, pressed: !r.pressed })
							)
						)}
					</div>
				)}
				{part.note && <p class="m-0 text-[11px] text-muted">{part.note}</p>}
			</div>
		);
	}

	private renderAvatar() {
		const author = this.item.author;
		if (this.continued) return <span class="w-8 shrink-0" aria-hidden="true" />;
		if (author?.avatar) return <img src={author.avatar} alt="" class="h-8 w-8 shrink-0 rounded-full object-cover" />;
		const initial = (author?.name || author?.id || "?").trim().charAt(0).toUpperCase();
		return (
			<span
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 font-heading text-sm text-accent"
				aria-hidden="true"
			>
				{initial}
			</span>
		);
	}

	private renderHeader() {
		const item = this.item;
		const self = item.side === "self";
		const showName = !self && !this.continued && !!item.author?.name;
		const meta = item.meta ?? [];
		const actions = item.actions ?? [];
		if (!showName && meta.length === 0 && actions.length === 0 && (self || this.continued)) return null;
		return (
			<div class={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted ${self ? "justify-end" : ""}`}>
				{showName && <span class="text-xs font-semibold text-text">{item.author?.name}</span>}
				{!self && !this.continued && <time dateTime={item.at}>{chatTime(item.at)}</time>}
				{meta.map((m) =>
					m.targetKey ? (
						<button
							key={m.id}
							type="button"
							class="hover:underline"
							title={m.title}
							onClick={() => this.adcChatQuoteClick.emit({ targetKey: m.targetKey! })}
						>
							{m.label}
						</button>
					) : (
						<span key={m.id} title={m.title}>
							{m.label}
						</span>
					)
				)}
				{actions.map((a) => this.renderActionButton({ ...a, variant: a.variant ?? "link" }, () => this.emitAction(a.id)))}
			</div>
		);
	}

	render() {
		const item = this.item;
		if (!item) return null;
		if (item.side === "system") {
			return (
				<Host class="block" data-chat-key={item.key}>
					<div class="mx-auto flex max-w-[85%] flex-col items-center gap-1 text-center text-xs text-muted">
						{item.parts.map((p) => p.blocks.map((b, i) => this.renderBlock(b, p.key, i)))}
					</div>
				</Host>
			);
		}
		const self = item.side === "self";
		return (
			<Host class={`block rounded-xxl transition-colors ${this.highlighted ? "bg-accent/10" : ""}`} data-chat-key={item.key}>
				<article class={`flex gap-2 ${self ? "justify-end" : ""}`}>
					{!self && this.renderAvatar()}
					<div class={`flex min-w-0 max-w-[88%] flex-col gap-1 sm:max-w-[75%] ${self ? "items-end" : "items-start"}`}>
						{this.renderHeader()}
						{item.replyTo && (
							<button
								type="button"
								class="line-clamp-2 max-w-full border-l-2 border-accent pl-2 text-left text-xs text-muted hover:text-text"
								onClick={() => this.adcChatQuoteClick.emit({ targetKey: item.replyTo!.key })}
							>
								↩ {item.replyTo.preview}
							</button>
						)}
						{item.parts.map((p) => this.renderPart(p))}
						{self && <adc-chat-receipt at={item.at} status={item.status} receipt={item.receipt} />}
					</div>
				</article>
			</Host>
		);
	}
}
