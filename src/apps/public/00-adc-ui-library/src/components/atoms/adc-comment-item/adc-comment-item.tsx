import { Component, Prop, h, Fragment, Event, EventEmitter, State } from "@stencil/core";
import type { Block } from "../../organisms/adc-blocks-renderer/adc-blocks-renderer";
import { buildAvatarUrl, fetchPublicProfile } from "../../../../utils/avatar.js";

export interface AttachmentLite {
	id: string;
	fileName: string;
	mimeType: string;
	size: number;
}

export interface CommentEntry {
	id: string;
	authorId: string;
	authorName?: string;
	authorImage?: string;
	blocks: Block[];
	attachments: AttachmentLite[];
	reactions: Record<string, string[]>;
	replyCount: number;
	depth: number;
	parentId: string | null;
	createdAt: string;
	updatedAt?: string;
	edited: boolean;
	deleted: boolean;
	label?: string;
	meta?: Record<string, unknown>;
}

/**
 * Render de un comentario individual con soporte de reacciones, reply,
 * edit y soft-delete. La lógica de tree (children) se delega al consumidor;
 * este componente sólo expone eventos.
 */
@Component({
	tag: "adc-comment-item",
	shadow: false,
})
export class AdcCommentItem {
	@Prop() comment!: CommentEntry;
	@Prop() canEdit: boolean = false;
	@Prop() canDelete: boolean = false;
	@Prop() canReply: boolean = false;
	@Prop() canReact: boolean = false;
	@Prop() currentUserId?: string;
	/** Map opcional de attachmentId -> URL para el renderer interno. */
	@Prop() attachmentUrls: Record<string, string> = {};
	/** Reacciones rápidas a mostrar siempre. */
	@Prop() quickReactions: string[] = ["👍", "❤️", "🎉", "😄", "🤔"];

	@State() confirmingDelete: boolean = false;
	@State() resolvedAvatar?: string;

	async componentWillLoad() {
		if (!this.comment?.authorImage && this.comment?.authorId) {
			try {
				const profile = await fetchPublicProfile(this.comment.authorId);
				if (profile.avatar) this.resolvedAvatar = profile.avatar;
			} catch {
				/* fallback a DiceBear se aplica en render */
			}
		}
	}

	@Event() adcDelete!: EventEmitter<string>;
	@Event() adcEdit!: EventEmitter<string>;
	@Event() adcReply!: EventEmitter<string>;
	@Event() adcReactToggle!: EventEmitter<{ commentId: string; emoji: string; reacted: boolean }>;
	@Event() adcAttachmentRequest!: EventEmitter<{ commentId: string; attachmentId: string }>;

	private isReactedByMe(emoji: string): boolean {
		const c = this.comment;
		const list = c.reactions?.[emoji];
		if (!list || !this.currentUserId) return false;
		return list.includes(this.currentUserId);
	}

	private readonly toggleReaction = (emoji: string) => {
		const reacted = this.isReactedByMe(emoji);
		this.adcReactToggle.emit({ commentId: this.comment.id, emoji, reacted: !reacted });
	};

	private readonly handleEdit = () => this.adcEdit.emit(this.comment.id);
	private readonly handleReply = () => this.adcReply.emit(this.comment.id);
	private readonly requestDelete = () => {
		this.confirmingDelete = true;
	};
	private readonly confirmDelete = () => {
		this.adcDelete.emit(this.comment.id);
		this.confirmingDelete = false;
	};
	private readonly cancelDelete = () => {
		this.confirmingDelete = false;
	};

	private renderReactions() {
		const c = this.comment;
		const present = Object.keys(c.reactions || {}).filter((e) => (c.reactions[e] || []).length > 0);
		const all = Array.from(new Set([...present, ...this.quickReactions]));
		return (
			<div class="flex flex-wrap gap-1 mt-2">
				{all.map((emoji) => {
					const count = c.reactions?.[emoji]?.length || 0;
					const mine = this.isReactedByMe(emoji);
					return (
						<button
							key={emoji}
							type="button"
							class={`text-sm px-2 py-0.5 rounded-full border ${mine ? "bg-primary/10 border-primary" : "border-alt"}`}
							onClick={() => this.toggleReaction(emoji)}
							disabled={!this.canReact}
							aria-pressed={mine ? "true" : "false"}
							aria-label={`${emoji}${count ? ` (${count})` : ""}`}
						>
							{emoji}
							{count > 0 && <span class="ml-1 text-xs">{count}</span>}
						</button>
					);
				})}
			</div>
		);
	}

	private renderActions() {
		if (this.comment.deleted) return null;
		return (
			<div class="flex items-center gap-2 mt-1 text-sm">
				{this.canReply && (
					<button type="button" class="text-link hover:underline" onClick={this.handleReply}>
						Responder
					</button>
				)}
				{this.canEdit && (
					<button type="button" class="text-link hover:underline" onClick={this.handleEdit}>
						Editar
					</button>
				)}
				{this.canDelete &&
					(this.confirmingDelete ? (
						<Fragment>
							<button type="button" class="text-tdanger" onClick={this.confirmDelete}>
								Confirmar
							</button>
							<button type="button" class="text-muted" onClick={this.cancelDelete}>
								Cancelar
							</button>
						</Fragment>
					) : (
						<button type="button" class="text-muted hover:text-tdanger" onClick={this.requestDelete}>
							Eliminar
						</button>
					))}
			</div>
		);
	}

	render() {
		const c = this.comment;
		const date = c.createdAt ? new Date(c.createdAt).toLocaleString() : "";
		const avatarSrc = buildAvatarUrl({
			avatar: c.authorImage || this.resolvedAvatar || null,
			seed: c.authorId || c.authorName || "default",
		});
		return (
			<li class="flex gap-3 p-3 bg-surface rounded-xxl shadow-cozy" data-comment-id={c.id} data-depth={c.depth}>
				<img src={avatarSrc} alt={c.authorName || "Avatar"} class="w-10 h-10 rounded-full object-cover shrink-0" />
				<div class="flex-1 min-w-0">
					<div class="flex items-baseline gap-2 flex-wrap">
						<span class="font-semibold text-text">{c.authorName || c.authorId}</span>
						<small class="text-muted">{date}</small>
						{c.edited && <small class="text-muted text-xs">(editado)</small>}
						{c.label && <span class="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{c.label}</span>}
					</div>
					{c.deleted ? (
						<p class="text-muted italic mt-1">Comentario eliminado</p>
					) : (
						<adc-blocks-renderer blocks={c.blocks} attachmentUrls={this.attachmentUrls} />
					)}
					{!c.deleted && this.renderReactions()}
					{this.renderActions()}
				</div>
			</li>
		);
	}
}
