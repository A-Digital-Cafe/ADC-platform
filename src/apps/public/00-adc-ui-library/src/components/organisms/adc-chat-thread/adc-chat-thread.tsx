import { Component, Prop, State, Event, EventEmitter, Element, Host, Watch } from "@stencil/core";
import type {
	ChatAction,
	ChatActionDetail,
	ChatConnection,
	ChatItem,
	ChatQuoteDetail,
	ChatReactionDetail,
	ChatReplyTarget,
	ChatSubmitDetail,
	ChatSuggestionDetail,
} from "@common/types/chat/thread.js";
import { chatDayKey, chatDayLabel, chatText } from "../../../utils/chat-i18n.js";

/** Distancia al fondo (px) que todavía cuenta como "estoy leyendo lo último". */
const BOTTOM_SLACK = 64;
/** Distancia al tope (px) que pide historial anterior. */
const TOP_TRIGGER = 48;
const HIGHLIGHT_MS = 1600;

const CONNECTION_DOT: Record<ChatConnection, string> = {
	live: "bg-tsuccess",
	polling: "bg-twarn",
	connecting: "bg-muted animate-pulse motion-reduce:animate-none",
	offline: "bg-tdanger",
};

/**
 * Conversación completa: encabezado, lista de mensajes y composer. Es de presentación —recibe
 * `items` y emite `adcChat*`— y resuelve lo que toda conversación necesita igual: quedarse pegada
 * al último mensaje mientras se lee el final, avisar los nuevos si se está leyendo arriba, pedir
 * historial al llegar al tope sin que la vista salte, separar por día y agrupar mensajes seguidos
 * del mismo autor. Ocupa el alto de su contenedor: el padre le da la altura.
 */
@Component({
	tag: "adc-chat-thread",
	shadow: false,
})
export class AdcChatThread {
	@Element() el!: HTMLElement;

	@Prop() items: ChatItem[] = [];
	@Prop() heading?: string;
	@Prop() subheading?: string;
	@Prop() connection?: ChatConnection;
	@Prop() headerActions: ChatAction[] = [];
	/** Carga inicial del historial (esqueleto en vez del "no hay mensajes"). */
	@Prop() loading: boolean = false;
	@Prop() hasOlder: boolean = false;
	@Prop() loadingOlder: boolean = false;
	@Prop() emptyMessage?: string;
	@Prop() typing: boolean = false;
	@Prop() typingLabel?: string;
	/** Minutos dentro de los cuales dos mensajes del mismo autor se agrupan. */
	@Prop() groupWindowMinutes: number = 5;
	@Prop() dayDividers: boolean = true;
	// ── Composer ──
	@Prop() hideComposer: boolean = false;
	@Prop() draft: string = "";
	@Prop() placeholder?: string;
	@Prop() sendLabel?: string;
	@Prop() sending: boolean = false;
	@Prop() composerDisabled: boolean = false;
	@Prop() replyingTo?: ChatReplyTarget;
	@Prop() composerActions: ChatAction[] = [];
	@Prop() maxLength?: number;

	@State() unseen: number = 0;
	@State() highlightedKey: string | null = null;

	@Event() adcChatSubmit!: EventEmitter<ChatSubmitDetail>;
	@Event() adcChatInput!: EventEmitter<{ text: string }>;
	@Event() adcChatCancelReply!: EventEmitter<void>;
	@Event() adcChatAction!: EventEmitter<ChatActionDetail>;
	@Event() adcChatSuggestion!: EventEmitter<ChatSuggestionDetail>;
	@Event() adcChatReaction!: EventEmitter<ChatReactionDetail>;
	@Event() adcChatQuoteClick!: EventEmitter<ChatQuoteDetail>;
	@Event() adcChatLoadOlder!: EventEmitter<void>;

	private scroller?: HTMLDivElement;
	private rendered: { first?: string; last?: string; count: number } = { count: 0 };
	private before = { height: 0, top: 0, atBottom: true };
	private olderRequestedAt?: string;
	private highlightTimer?: ReturnType<typeof setTimeout>;

	disconnectedCallback() {
		if (this.highlightTimer) clearTimeout(this.highlightTimer);
	}

	@Watch("loadingOlder")
	onLoadingOlder(next: boolean) {
		// Terminó una carga: se puede volver a pedir si el tope sigue a la vista y hay más.
		if (!next) this.olderRequestedAt = undefined;
	}

	componentWillRender() {
		const s = this.scroller;
		if (!s) return;
		this.before = { height: s.scrollHeight, top: s.scrollTop, atBottom: this.isAtBottom() };
	}

	componentDidRender() {
		const s = this.scroller;
		const items = this.items ?? [];
		const first = items[0]?.key;
		const last = items[items.length - 1]?.key;
		const prev = this.rendered;
		this.rendered = { first, last, count: items.length };
		if (!s) return;

		if (prev.count === 0 && items.length > 0) {
			this.scrollToBottom();
			return;
		}
		const prepended = !!prev.first && first !== prev.first && items.some((i) => i.key === prev.first);
		if (prepended) {
			// Historial nuevo arriba: se compensa la altura agregada para que lo que se leía no se mueva.
			s.scrollTop = this.before.top + (s.scrollHeight - this.before.height);
			return;
		}
		const appended = !!last && last !== prev.last;
		if (this.before.atBottom || (appended && items[items.length - 1]?.side === "self")) {
			this.scrollToBottom();
			if (this.unseen) this.unseen = 0;
			return;
		}
		if (appended) {
			const from = prev.last ? items.findIndex((i) => i.key === prev.last) : -1;
			const added = from >= 0 ? items.length - 1 - from : 1;
			if (added > 0) this.unseen += added;
		}
	}

	private isAtBottom(): boolean {
		const s = this.scroller;
		return !s || s.scrollHeight - s.scrollTop - s.clientHeight < BOTTOM_SLACK;
	}

	private scrollToBottom(smooth = false) {
		const s = this.scroller;
		if (!s) return;
		s.scrollTo({ top: s.scrollHeight, behavior: smooth && !this.reducedMotion() ? "smooth" : "auto" });
	}

	private reducedMotion(): boolean {
		return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
	}

	private readonly onScroll = () => {
		const s = this.scroller;
		if (!s) return;
		if (this.unseen && this.isAtBottom()) this.unseen = 0;
		const first = this.items[0]?.key;
		if (s.scrollTop < TOP_TRIGGER && this.hasOlder && !this.loadingOlder && first && this.olderRequestedAt !== first) {
			this.olderRequestedAt = first;
			this.adcChatLoadOlder.emit();
		}
	};

	private readonly jumpToNew = () => {
		this.scrollToBottom(true);
		this.unseen = 0;
	};

	private readonly onQuote = (ev: CustomEvent<ChatQuoteDetail>) => {
		ev.stopPropagation();
		const key = ev.detail.targetKey;
		const target = this.scroller?.querySelector<HTMLElement>(`[data-chat-key="${CSS.escape(key)}"]`);
		if (target) {
			target.scrollIntoView({ block: "center", behavior: this.reducedMotion() ? "auto" : "smooth" });
			this.highlightedKey = key;
			if (this.highlightTimer) clearTimeout(this.highlightTimer);
			this.highlightTimer = setTimeout(() => (this.highlightedKey = null), HIGHLIGHT_MS);
		}
		this.adcChatQuoteClick.emit({ targetKey: key, found: !!target });
	};

	private relay<T>(emitter: EventEmitter<T>) {
		return (ev: CustomEvent<T>) => {
			ev.stopPropagation();
			emitter.emit(ev.detail);
		};
	}

	/** ¿Este mensaje continúa al anterior (mismo autor, mismo día, dentro de la ventana)? */
	private continues(prev: ChatItem | undefined, item: ChatItem): boolean {
		if (!prev || prev.side !== item.side || item.side === "system") return false;
		if ((prev.author?.id ?? prev.side) !== (item.author?.id ?? item.side)) return false;
		if (chatDayKey(prev.at) !== chatDayKey(item.at)) return false;
		const gap = Date.parse(item.at) - Date.parse(prev.at);
		return Number.isFinite(gap) && gap >= 0 && gap <= this.groupWindowMinutes * 60_000;
	}

	private renderHeader() {
		if (!this.heading && !this.connection && this.headerActions.length === 0) return null;
		return (
			<header class="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-3 py-2">
				<div class="min-w-0">
					{this.heading && <h2 class="m-0 truncate font-heading text-base text-text">{this.heading}</h2>}
					{this.subheading && <p class="m-0 truncate text-xs text-muted">{this.subheading}</p>}
				</div>
				<div class="flex flex-wrap items-center gap-2">
					{this.connection && (
						<span class="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
							<span class={`h-2 w-2 rounded-full ${CONNECTION_DOT[this.connection]}`} aria-hidden="true" />
							{chatText(`connection.${this.connection}`)}
						</span>
					)}
					{this.headerActions.map((a) => (
						<adc-button
							key={a.id}
							type="button"
							size="small"
							variant={a.variant === "primary" ? "primary" : a.variant === "danger" ? "danger-outlined" : "accent-outlined"}
							label={a.label}
							ariaLabel={a.ariaLabel}
							disabled={a.disabled}
							onClick={() => this.adcChatAction.emit({ scope: "header", actionId: a.id })}
						/>
					))}
				</div>
			</header>
		);
	}

	private renderList() {
		const items = this.items ?? [];
		if (this.loading && items.length === 0) {
			return (
				<div class="flex flex-col gap-3 p-2" aria-busy="true">
					<adc-skeleton variant="rectangular" height="2.5rem" width="60%" rounded="1rem" />
					<adc-skeleton variant="rectangular" height="2.5rem" width="45%" rounded="1rem" />
					<adc-skeleton variant="rectangular" height="3.5rem" width="70%" rounded="1rem" />
				</div>
			);
		}
		if (items.length === 0) return <p class="m-auto p-6 text-center text-sm text-muted">{this.emptyMessage || chatText("empty")}</p>;

		const rows = items.flatMap((item, i) => {
			const prev = items[i - 1];
			const continued = this.continues(prev, item);
			const day = this.dayDividers && (!prev || chatDayKey(prev.at) !== chatDayKey(item.at));
			return [
				day && (
					<li key={`day-${chatDayKey(item.at)}`} class="flex items-center gap-3 py-1 text-[11px] text-muted" role="separator">
						<span class="h-px flex-1 bg-divider" />
						<span class="first-letter:uppercase">{chatDayLabel(item.at)}</span>
						<span class="h-px flex-1 bg-divider" />
					</li>
				),
				<li key={item.key} class={continued ? "-mt-2" : ""}>
					<adc-chat-message
						item={item}
						continued={continued}
						highlighted={this.highlightedKey === item.key}
						onAdcChatAction={this.relay(this.adcChatAction)}
						onAdcChatSuggestion={this.relay(this.adcChatSuggestion)}
						onAdcChatReaction={this.relay(this.adcChatReaction)}
						onAdcChatQuoteClick={this.onQuote}
					/>
				</li>,
			];
		});
		return (
			<ol
				class="m-0 flex list-none flex-col gap-3 p-0"
				role="log"
				aria-live="polite"
				aria-relevant="additions"
				aria-label={this.heading || chatText("log")}
			>
				{rows}
			</ol>
		);
	}

	render() {
		return (
			<Host class="flex h-full min-h-0 flex-col bg-background">
				{this.renderHeader()}
				<div class="relative flex min-h-0 flex-1 flex-col">
					<div
						class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-3"
						ref={(el) => (this.scroller = el)}
						onScroll={this.onScroll}
					>
						{this.hasOlder && (
							<div class="flex justify-center pb-2">
								<button
									type="button"
									class="rounded-full px-3 py-1 text-xs text-muted hover:bg-surface hover:text-text disabled:opacity-60"
									disabled={this.loadingOlder}
									onClick={() => {
										this.olderRequestedAt = this.items[0]?.key;
										this.adcChatLoadOlder.emit();
									}}
								>
									{this.loadingOlder ? chatText("loadingOlder") : chatText("loadOlder")}
								</button>
							</div>
						)}
						{this.renderList()}
						{this.typing && (
							<div class="pt-3">
								<adc-typing-indicator label={this.typingLabel} />
							</div>
						)}
					</div>
					{this.unseen > 0 && (
						<button
							type="button"
							class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs text-tprimary shadow-cozy"
							onClick={this.jumpToNew}
						>
							{chatText("newMessages")} ({this.unseen}) ↓
						</button>
					)}
				</div>
				{!this.hideComposer && (
					<div class="border-t border-divider px-3 py-2">
						<adc-chat-composer
							value={this.draft}
							placeholder={this.placeholder}
							sendLabel={this.sendLabel}
							sending={this.sending}
							disabled={this.composerDisabled}
							replyingTo={this.replyingTo}
							actions={this.composerActions}
							maxLength={this.maxLength}
							onAdcChatInput={this.relay(this.adcChatInput)}
							onAdcChatSubmit={this.relay(this.adcChatSubmit)}
							onAdcChatCancelReply={this.relay(this.adcChatCancelReply)}
							onAdcChatAction={this.relay(this.adcChatAction)}
						/>
					</div>
				)}
			</Host>
		);
	}
}
