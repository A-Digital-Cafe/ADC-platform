import { Component, Prop, h, Event, EventEmitter, State } from "@stencil/core";
import type { CommentEntry } from "../../atoms/adc-comment-item/adc-comment-item";
import type { Block } from "../adc-blocks-renderer/adc-blocks-renderer";

export interface SessionLike {
	authenticated: boolean;
	userId?: string;
	canComment?: boolean;
	canModerate?: boolean;
}

export interface CommentTreeNode extends CommentEntry {
	children: CommentTreeNode[];
}

export interface CommentsSectionSubmitDetail {
	blocks: Block[];
	attachmentIds: string[];
	parentId: string | null;
	editingCommentId: string | null;
}

/**
 * Sección de comentarios completa: tree, replies anidados, reacciones,
 * edición inline, drafts (delegados al consumidor) y carga incremental.
 */
@Component({
	tag: "adc-comments-section",
	shadow: false,
})
export class AdcCommentsSection {
	@Prop() comments: CommentTreeNode[] = [];
	@Prop() session: SessionLike = { authenticated: false };
	@Prop() submitting: boolean = false;
	@Prop() loading: boolean = false;
	@Prop() hasMore: boolean = false;
	@Prop() loadingMore: boolean = false;
	@Prop() articleAuthorId?: string;
	@Prop() attachmentUrls: Record<string, string> = {};
	@Prop() initialDraftBlocks: Block[] = [];
	@Prop() initialDraftAttachmentIds: string[] = [];
	@Prop() maxDepth: number = 3;
	@Prop() emptyMessage: string = "Aún no hay comentarios.";

	@State() replyingTo: string | null = null;
	@State() editingId: string | null = null;
	@State() editingBlocks: Block[] = [];

	@Event() adcSubmit!: EventEmitter<CommentsSectionSubmitDetail>;
	@Event() adcDelete!: EventEmitter<string>;
	@Event() adcReactToggle!: EventEmitter<{ commentId: string; emoji: string; reacted: boolean }>;
	@Event() adcLoadMore!: EventEmitter<void>;
	@Event() adcDraftChange!: EventEmitter<{
		parentId: string | null;
		editingCommentId: string | null;
		blocks: Block[];
		attachmentIds: string[];
	}>;
	@Event() adcRequestAttachment!: EventEmitter<{
		kind: "image" | "file";
		parentId: string | null;
		editingCommentId: string | null;
	}>;

	private canEdit(c: CommentEntry): boolean {
		return this.session.authenticated && c.authorId === this.session.userId && !c.deleted;
	}
	private canDelete(c: CommentEntry): boolean {
		if (!this.session.authenticated || !this.session.userId) return false;
		if (this.session.canModerate) return true;
		if (c.authorId === this.session.userId) return true;
		if (this.articleAuthorId && this.articleAuthorId === this.session.userId) return true;
		return false;
	}

	private readonly handleRootSubmit = (ev: CustomEvent<{ blocks: Block[]; attachmentIds: string[] }>) => {
		ev.stopPropagation();
		this.adcSubmit.emit({ ...ev.detail, parentId: null, editingCommentId: null });
	};
	private readonly handleReplySubmit = (parentId: string, ev: CustomEvent<{ blocks: Block[]; attachmentIds: string[] }>) => {
		ev.stopPropagation();
		this.adcSubmit.emit({ ...ev.detail, parentId, editingCommentId: null });
		this.replyingTo = null;
	};
	private readonly handleEditSubmit = (commentId: string, ev: CustomEvent<{ blocks: Block[]; attachmentIds: string[] }>) => {
		ev.stopPropagation();
		this.adcSubmit.emit({ ...ev.detail, parentId: null, editingCommentId: commentId });
		this.editingId = null;
	};

	private readonly handleDraftChange = (
		parentId: string | null,
		editingCommentId: string | null,
		ev: CustomEvent<{ blocks: Block[]; attachmentIds: string[] }>
	) => {
		ev.stopPropagation();
		this.adcDraftChange.emit({ parentId, editingCommentId, ...ev.detail });
	};

	private readonly handleRequestAttachment = (
		parentId: string | null,
		editingCommentId: string | null,
		ev: CustomEvent<{ kind: "image" | "file" }>
	) => {
		ev.stopPropagation();
		this.adcRequestAttachment.emit({ ...ev.detail, parentId, editingCommentId });
	};

	private readonly handleReply = (id: string) => {
		this.replyingTo = this.replyingTo === id ? null : id;
	};
	private readonly handleEdit = (id: string) => {
		const found = this.findInTree(this.comments, id);
		if (!found) return;
		this.editingId = id;
		this.editingBlocks = found.blocks;
	};

	private findInTree(nodes: CommentTreeNode[], id: string): CommentTreeNode | null {
		for (const n of nodes) {
			if (n.id === id) return n;
			const child = this.findInTree(n.children, id);
			if (child) return child;
		}
		return null;
	}

	private renderForm() {
		if (!this.session.authenticated || !this.session.canComment) return null;
		return (
			<adc-comment-form
				submitting={this.submitting}
				initialBlocks={this.initialDraftBlocks}
				initialAttachmentIds={this.initialDraftAttachmentIds}
				onAdcSubmit={this.handleRootSubmit}
				onAdcDraftChange={(ev: CustomEvent<{ blocks: Block[]; attachmentIds: string[] }>) => this.handleDraftChange(null, null, ev)}
				onAdcRequestAttachment={(ev: CustomEvent<{ kind: "image" | "file" }>) => this.handleRequestAttachment(null, null, ev)}
			/>
		);
	}

	private renderNode(node: CommentTreeNode) {
		const isEditing = this.editingId === node.id;
		const isReplying = this.replyingTo === node.id;
		return (
			<li key={node.id} class="flex flex-col gap-2 list-none p-0">
				{isEditing ? (
					<adc-comment-form
						submitting={this.submitting}
						submitLabel="Guardar"
						showCancel={true}
						initialBlocks={this.editingBlocks}
						onAdcSubmit={(ev: CustomEvent<{ blocks: Block[]; attachmentIds: string[] }>) => this.handleEditSubmit(node.id, ev)}
						onAdcCancel={() => {
							this.editingId = null;
						}}
						onAdcDraftChange={(ev: CustomEvent<{ blocks: Block[]; attachmentIds: string[] }>) =>
							this.handleDraftChange(null, node.id, ev)
						}
						onAdcRequestAttachment={(ev: CustomEvent<{ kind: "image" | "file" }>) => this.handleRequestAttachment(null, node.id, ev)}
					/>
				) : (
					<adc-comment-item
						comment={node}
						canEdit={this.canEdit(node)}
						canDelete={this.canDelete(node)}
						canReply={!!this.session.authenticated && node.depth < this.maxDepth - 1 && !node.deleted}
						canReact={!!this.session.authenticated}
						currentUserId={this.session.userId}
						attachmentUrls={this.attachmentUrls}
						onAdcDelete={(ev: CustomEvent<string>) => {
							ev.stopPropagation();
							this.adcDelete.emit(ev.detail);
						}}
						onAdcEdit={(ev: CustomEvent<string>) => {
							ev.stopPropagation();
							this.handleEdit(ev.detail);
						}}
						onAdcReply={(ev: CustomEvent<string>) => {
							ev.stopPropagation();
							this.handleReply(ev.detail);
						}}
						onAdcReactToggle={(ev: CustomEvent<{ commentId: string; emoji: string; reacted: boolean }>) => {
							ev.stopPropagation();
							this.adcReactToggle.emit(ev.detail);
						}}
					/>
				)}
				{isReplying && (
					<div class="ml-12">
						<adc-comment-form
							submitting={this.submitting}
							submitLabel="Responder"
							showCancel={true}
							placeholder="Escribe una respuesta..."
							onAdcSubmit={(ev: CustomEvent<{ blocks: Block[]; attachmentIds: string[] }>) => this.handleReplySubmit(node.id, ev)}
							onAdcCancel={() => {
								this.replyingTo = null;
							}}
							onAdcDraftChange={(ev: CustomEvent<{ blocks: Block[]; attachmentIds: string[] }>) =>
								this.handleDraftChange(node.id, null, ev)
							}
							onAdcRequestAttachment={(ev: CustomEvent<{ kind: "image" | "file" }>) =>
								this.handleRequestAttachment(node.id, null, ev)
							}
						/>
					</div>
				)}
				{node.children.length > 0 && (
					<ul class="ml-8 flex flex-col gap-2 list-none p-0 border-l border-alt pl-3">
						{node.children.map((child) => this.renderNode(child))}
					</ul>
				)}
			</li>
		);
	}

	render() {
		return (
			<section class="flex flex-col gap-4" aria-label="Comentarios">
				{this.renderForm()}
				{this.loading ? (
					<p class="text-muted text-center">Cargando comentarios...</p>
				) : this.comments.length === 0 ? (
					<p class="text-muted text-center">{this.emptyMessage}</p>
				) : (
					<ul class="flex flex-col gap-3 list-none p-0">{this.comments.map((c) => this.renderNode(c))}</ul>
				)}
				{this.hasMore && (
					<div class="flex justify-center">
						<adc-button
							type="button"
							variant="accent"
							disabled={this.loadingMore}
							onClick={() => this.adcLoadMore.emit()}
							label={this.loadingMore ? "Cargando..." : "Cargar más"}
						/>
					</div>
				)}
			</section>
		);
	}
}
