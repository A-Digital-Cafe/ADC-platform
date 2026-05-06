import type { Model } from "mongoose";
import type { CommentDraft } from "../../../../common/types/comments/Comment.js";
import { COMMENT_MAX_ATTACHMENTS } from "../../../../common/types/comments/Comment.js";
import type { Block } from "../../../../common/ADC/types/learning.js";
import { sanitizeBlocks } from "../../../../common/utils/blocks/sanitize.js";
import type { CommentDraftDoc } from "../schemas/draft.schema.js";

export interface DraftKey {
	targetType: string;
	targetId: string;
	parentId?: string | null;
	editingCommentId?: string | null;
}

export interface DraftPayload {
	blocks: Block[];
	attachmentIds?: string[];
}

/**
 * Construye un id determinístico por (owner, target, parent, editing).
 * Encoded para evitar colisiones si los componentes contienen `:`.
 */
export function buildDraftId(ownerId: string, k: DraftKey): string {
	const parts = [ownerId, k.targetType, k.targetId, k.parentId ?? "_", k.editingCommentId ?? "_"];
	return parts.map((p) => encodeURIComponent(p)).join(":");
}

function toDraft(doc: CommentDraftDoc): CommentDraft {
	return {
		id: String(doc._id),
		ownerId: doc.ownerId,
		targetType: doc.targetType,
		targetId: doc.targetId,
		parentId: doc.parentId,
		editingCommentId: doc.editingCommentId,
		blocks: doc.blocks as Block[],
		attachmentIds: doc.attachmentIds ?? [],
		updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : String(doc.updatedAt),
	};
}

/**
 * Repositorio puro de drafts. NO valida permisos: el llamador (CommentsManager)
 * autoriza antes de invocar cualquier método de aquí.
 */
export class DraftsRepository {
	readonly #model: Model<CommentDraftDoc>;
	readonly #maxBlocks: number;

	constructor(model: Model<CommentDraftDoc>, maxBlocks: number) {
		this.#model = model;
		this.#maxBlocks = maxBlocks;
	}

	async save(ownerId: string, key: DraftKey, payload: DraftPayload): Promise<CommentDraft> {
		const sanitized = sanitizeBlocks(payload.blocks, { maxBlocks: this.#maxBlocks });
		const id = buildDraftId(ownerId, key);
		const attachmentIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds.slice(0, COMMENT_MAX_ATTACHMENTS) : [];
		await this.#model.updateOne(
			{ _id: id },
			{
				$set: {
					ownerId,
					targetType: key.targetType,
					targetId: key.targetId,
					parentId: key.parentId ?? null,
					editingCommentId: key.editingCommentId ?? null,
					blocks: sanitized,
					attachmentIds,
					updatedAt: new Date(),
				},
			},
			{ upsert: true }
		);
		const doc = await this.#model.findById(id).lean<CommentDraftDoc>();
		return toDraft(doc!);
	}

	async get(ownerId: string, key: DraftKey): Promise<CommentDraft | null> {
		const id = buildDraftId(ownerId, key);
		const doc = await this.#model.findById(id).lean<CommentDraftDoc>();
		// Defensa en profundidad: aunque el id incluye ownerId, validamos también
		// el campo persistido por si la colección tuviera datos legados.
		if (!doc || doc.ownerId !== ownerId) return null;
		return toDraft(doc);
	}

	async delete(ownerId: string, key: DraftKey): Promise<void> {
		const id = buildDraftId(ownerId, key);
		await this.#model.deleteOne({ _id: id, ownerId });
	}

	async deleteForCreate(ownerId: string, target: { targetType: string; targetId: string; parentId: string | null }): Promise<void> {
		const id = buildDraftId(ownerId, { ...target, editingCommentId: null });
		await this.#model.deleteOne({ _id: id, ownerId }).catch(() => {
			/* noop */
		});
	}

	async deleteForEdit(
		ownerId: string,
		doc: { targetType: string; targetId: string; parentId: string | null },
		commentId: string
	): Promise<void> {
		const id = buildDraftId(ownerId, { ...doc, editingCommentId: commentId });
		await this.#model.deleteOne({ _id: id, ownerId }).catch(() => {
			/* noop */
		});
	}
}
