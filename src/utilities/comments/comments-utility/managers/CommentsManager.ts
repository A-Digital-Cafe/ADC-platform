import { randomUUID } from "node:crypto";
import type { Model } from "mongoose";
import type { Comment, CommentDraft, CommentLabel, CommentsPage } from "../../../../common/types/comments/Comment.js";
import {
	COMMENT_MAX_ATTACHMENTS,
	COMMENT_MAX_BLOCKS,
	COMMENT_MAX_DEPTH,
	COMMENT_REACTION_MAX_EMOJI_LENGTH,
} from "../../../../common/types/comments/Comment.js";
import type { Block } from "../../../../common/ADC/types/learning.js";
import { extractAttachmentIdsFromBlocks, sanitizeBlocks } from "../../../../common/utils/blocks/sanitize.js";
import type { CommentDoc } from "../schemas/comment.schema.js";
import type { CommentDraftDoc } from "../schemas/draft.schema.js";
import type { AttachmentsManager } from "../../../attachments/attachments-utility/managers/AttachmentsManager.js";
import type { AttachmentDTO } from "../../../../common/types/attachments/Attachment.js";
import { CommentError } from "../../../../common/types/custom-errors/CommentError.ts";
import { DraftsRepository, type DraftKey, type DraftPayload } from "../helpers/drafts.ts";

export type { DraftKey, DraftPayload };

export type CommentAction = "list" | "create" | "reply" | "edit" | "delete" | "react" | "moderate";

export interface CommentPermissionContext {
	userId: string;
	authorName?: string;
	authorImage?: string;
}

export type CommentPermissionChecker = (action: CommentAction, ctx: CommentPermissionContext, comment?: Comment) => Promise<boolean> | boolean;

export interface CommentsManagerOptions {
	commentModel: Model<CommentDoc>;
	draftModel: Model<CommentDraftDoc>;
	attachmentsManager?: AttachmentsManager;
	permissionChecker: CommentPermissionChecker;
	maxThreadDepth?: number;
	maxBlocksPerComment?: number;
	editWindowMs?: number | null;
}

export interface CreateInput {
	targetType: string;
	targetId: string;
	parentId?: string | null;
	blocks: Block[];
	attachmentIds?: string[];
	label?: CommentLabel;
	meta?: Record<string, unknown>;
}

export interface UpdateInput {
	blocks: Block[];
	attachmentIds?: string[];
}

export interface ListOptions {
	targetType: string;
	targetId: string;
	parentId?: string | null;
	cursor?: string | null;
	limit?: number;
}

export interface ThreadOptions {
	cursor?: string | null;
	limit?: number;
}

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
// Caracteres de control C0 (\u0000–\u001F) y DEL (\u007F) no permitidos en emojis.
// eslint-disable-next-line no-control-regex
const EMOJI_DENY = /[\u0000-\u001F\u007F]/;

function clampLimit(limit?: number): number {
	if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_PAGE_LIMIT;
	return Math.min(MAX_PAGE_LIMIT, Math.floor(limit));
}

function err(
	status: number,
	code:
		| "COMMENT_FORBIDDEN"
		| "COMMENT_NOT_FOUND"
		| "COMMENT_PARENT_NOT_FOUND"
		| "COMMENT_PARENT_MISMATCH"
		| "COMMENT_DEPTH_EXCEEDED"
		| "COMMENT_EMPTY"
		| "COMMENT_TOO_MANY_ATTACHMENTS"
		| "COMMENT_ATTACHMENTS_DISABLED"
		| "COMMENT_BAD_ATTACHMENT"
		| "COMMENT_ATTACHMENT_NOT_OWNED"
		| "COMMENT_EDIT_WINDOW_CLOSED"
		| "COMMENT_BAD_EMOJI",
	message: string
): CommentError {
	return new CommentError(status, code, message);
}

export class CommentsManager {
	readonly #model: Model<CommentDoc>;
	readonly #drafts: DraftsRepository;
	readonly #attachments?: AttachmentsManager;
	readonly #permissionChecker: CommentPermissionChecker;
	readonly #maxDepth: number;
	readonly #maxBlocks: number;
	readonly #editWindowMs: number | null;

	constructor(opts: CommentsManagerOptions) {
		this.#model = opts.commentModel;
		this.#maxBlocks = opts.maxBlocksPerComment ?? COMMENT_MAX_BLOCKS;
		this.#drafts = new DraftsRepository(opts.draftModel, this.#maxBlocks);
		this.#attachments = opts.attachmentsManager;
		this.#permissionChecker = opts.permissionChecker;
		this.#maxDepth = opts.maxThreadDepth ?? COMMENT_MAX_DEPTH;
		this.#editWindowMs = opts.editWindowMs ?? null;
	}

	async #checkPermission(action: CommentAction, ctx: CommentPermissionContext, comment?: Comment): Promise<void> {
		const ok = await this.#permissionChecker(action, ctx, comment);
		if (!ok) throw err(403, "COMMENT_FORBIDDEN", `No autorizado para acción "${action}"`);
	}

	async #validateAttachments(
		ctx: CommentPermissionContext,
		blocks: Block[],
		extra: string[] = []
	): Promise<{ ids: string[]; dtos: AttachmentDTO[] }> {
		const fromBlocks = extractAttachmentIdsFromBlocks(blocks);
		const all = Array.from(new Set([...fromBlocks, ...extra]));
		if (!all.length) return { ids: [], dtos: [] };
		if (all.length > COMMENT_MAX_ATTACHMENTS) {
			throw err(400, "COMMENT_TOO_MANY_ATTACHMENTS", `Máximo ${COMMENT_MAX_ATTACHMENTS} adjuntos por comentario`);
		}
		if (!this.#attachments) {
			throw err(400, "COMMENT_ATTACHMENTS_DISABLED", "Este servicio no soporta adjuntos en comentarios");
		}
		const found = await this.#attachments.getMany(ctx as any, all);
		if (found.length !== all.length) {
			throw err(400, "COMMENT_BAD_ATTACHMENT", "Adjunto inválido o no autorizado");
		}
		// El uploader debe coincidir con el autor del comentario
		for (const att of found) {
			if (att.uploadedBy !== ctx.userId) {
				throw err(403, "COMMENT_ATTACHMENT_NOT_OWNED", "Solo puedes referenciar adjuntos que subiste");
			}
		}
		return { ids: all, dtos: found.map((f) => this.#attachments!.toDto(f)) };
	}

	async create(ctx: CommentPermissionContext, input: CreateInput): Promise<Comment> {
		const parentId = input.parentId ?? null;
		await this.#checkPermission(parentId ? "reply" : "create", ctx);

		const sanitized = sanitizeBlocks(input.blocks, { maxBlocks: this.#maxBlocks });
		if (!sanitized.length) throw err(400, "COMMENT_EMPTY", "El comentario no puede estar vacío");

		let parent: CommentDoc | null = null;
		if (parentId) {
			parent = await this.#model.findById(parentId).lean<CommentDoc>();
			if (!parent || parent.deleted) throw err(404, "COMMENT_PARENT_NOT_FOUND", "Comentario padre no encontrado");
			if (parent.targetType !== input.targetType || parent.targetId !== input.targetId) {
				throw err(400, "COMMENT_PARENT_MISMATCH", "El comentario padre pertenece a otro recurso");
			}
		}
		const depth = parent ? parent.depth + 1 : 0;
		if (depth > this.#maxDepth) {
			throw err(400, "COMMENT_DEPTH_EXCEEDED", `Profundidad máxima de hilo: ${this.#maxDepth}`);
		}

		const { ids: attachmentIds } = await this.#validateAttachments(ctx, sanitized, input.attachmentIds ?? []);

		const id = randomUUID();
		const threadRootId = parent ? parent.threadRootId : id;
		const now = new Date();

		const doc: CommentDoc = {
			_id: id,
			targetType: input.targetType,
			targetId: input.targetId,
			parentId,
			threadRootId,
			depth,
			authorId: ctx.userId,
			authorName: ctx.authorName,
			authorImage: ctx.authorImage,
			blocks: sanitized,
			attachmentIds,
			reactions: {},
			replyCount: 0,
			label: input.label,
			meta: input.meta,
			createdAt: now,
			edited: false,
			deleted: false,
		};

		await this.#model.create(doc);

		if (parent) {
			await this.#model.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } });
		}

		// borra el draft asociado
		await this.#drafts.deleteForCreate(ctx.userId, {
			targetType: input.targetType,
			targetId: input.targetId,
			parentId,
		});

		return this.#hydrate(ctx, [doc]).then((arr) => arr[0]);
	}

	async update(ctx: CommentPermissionContext, commentId: string, input: UpdateInput): Promise<Comment> {
		const doc = await this.#model.findById(commentId).lean<CommentDoc>();
		if (!doc || doc.deleted) throw err(404, "COMMENT_NOT_FOUND", "Comentario no encontrado");
		const comment = this.#docToCommentNoAttachments(doc);
		await this.#checkPermission("edit", ctx, comment);

		if (this.#editWindowMs && Date.now() - doc.createdAt.getTime() > this.#editWindowMs) {
			throw err(403, "COMMENT_EDIT_WINDOW_CLOSED", "Ya no se puede editar este comentario");
		}

		const sanitized = sanitizeBlocks(input.blocks, { maxBlocks: this.#maxBlocks });
		if (!sanitized.length) throw err(400, "COMMENT_EMPTY", "El comentario no puede estar vacío");
		const { ids: attachmentIds } = await this.#validateAttachments(ctx, sanitized, input.attachmentIds ?? []);

		const updatedAt = new Date();
		await this.#model.updateOne({ _id: commentId }, { $set: { blocks: sanitized, attachmentIds, edited: true, updatedAt } });
		const updatedDoc = { ...doc, blocks: sanitized, attachmentIds, edited: true, updatedAt };

		await this.#drafts.deleteForEdit(ctx.userId, { targetType: doc.targetType, targetId: doc.targetId, parentId: doc.parentId }, commentId);

		return this.#hydrate(ctx, [updatedDoc]).then((arr) => arr[0]);
	}

	async delete(ctx: CommentPermissionContext, commentId: string): Promise<void> {
		const doc = await this.#model.findById(commentId).lean<CommentDoc>();
		if (!doc) return;
		const comment = this.#docToCommentNoAttachments(doc);
		await this.#checkPermission("delete", ctx, comment);

		if (doc.replyCount > 0) {
			// soft delete preservando hilo
			await this.#model.updateOne(
				{ _id: commentId },
				{
					$set: {
						deleted: true,
						blocks: [],
						attachmentIds: [],
						reactions: {},
						label: undefined,
						meta: undefined,
					},
				}
			);
			return;
		}

		await this.#model.deleteOne({ _id: commentId });
		if (doc.parentId) {
			await this.#model.updateOne({ _id: doc.parentId, replyCount: { $gt: 0 } }, { $inc: { replyCount: -1 } });
		}
	}

	async react(ctx: CommentPermissionContext, commentId: string, emoji: string): Promise<Comment> {
		const cleaned = this.#validateEmoji(emoji);
		const doc = await this.#model.findById(commentId).lean<CommentDoc>();
		if (!doc || doc.deleted) throw err(404, "COMMENT_NOT_FOUND", "Comentario no encontrado");
		const comment = this.#docToCommentNoAttachments(doc);
		await this.#checkPermission("react", ctx, comment);
		await this.#model.updateOne({ _id: commentId }, { $addToSet: { [`reactions.${cleaned}`]: ctx.userId } });
		const refreshed = await this.#model.findById(commentId).lean<CommentDoc>();
		return this.#hydrate(ctx, [refreshed!]).then((arr) => arr[0]);
	}

	async unreact(ctx: CommentPermissionContext, commentId: string, emoji: string): Promise<Comment> {
		const cleaned = this.#validateEmoji(emoji);
		const doc = await this.#model.findById(commentId).lean<CommentDoc>();
		if (!doc || doc.deleted) throw err(404, "COMMENT_NOT_FOUND", "Comentario no encontrado");
		const comment = this.#docToCommentNoAttachments(doc);
		await this.#checkPermission("react", ctx, comment);
		await this.#model.updateOne({ _id: commentId }, { $pull: { [`reactions.${cleaned}`]: ctx.userId } });
		// limpia clave si quedó vacía
		await this.#model.updateOne({ _id: commentId, [`reactions.${cleaned}`]: { $size: 0 } }, { $unset: { [`reactions.${cleaned}`]: "" } });
		const refreshed = await this.#model.findById(commentId).lean<CommentDoc>();
		return this.#hydrate(ctx, [refreshed!]).then((arr) => arr[0]);
	}

	async list(ctx: CommentPermissionContext, opts: ListOptions): Promise<CommentsPage> {
		await this.#checkPermission("list", ctx);
		const limit = clampLimit(opts.limit);
		const filter: Record<string, unknown> = {
			targetType: opts.targetType,
			targetId: opts.targetId,
			parentId: opts.parentId ?? null,
		};
		if (opts.cursor) filter._id = { $lt: opts.cursor };
		const docs = await this.#model
			.find(filter)
			.sort({ _id: -1 })
			.limit(limit + 1)
			.lean<CommentDoc[]>();
		const hasMore = docs.length > limit;
		const slice = docs.slice(0, limit);
		const items = await this.#hydrate(ctx, slice);
		return { items, nextCursor: hasMore ? String(slice[slice.length - 1]._id) : null };
	}

	async getThread(ctx: CommentPermissionContext, threadRootId: string, opts: ThreadOptions = {}): Promise<CommentsPage> {
		await this.#checkPermission("list", ctx);
		const limit = clampLimit(opts.limit);
		const filter: Record<string, unknown> = { threadRootId };
		if (opts.cursor) filter._id = { $gt: opts.cursor };
		const docs = await this.#model
			.find(filter)
			.sort({ _id: 1 })
			.limit(limit + 1)
			.lean<CommentDoc[]>();
		const hasMore = docs.length > limit;
		const slice = docs.slice(0, limit);
		const items = await this.#hydrate(ctx, slice);
		return { items, nextCursor: hasMore ? String(slice[slice.length - 1]._id) : null };
	}

	async getById(ctx: CommentPermissionContext, commentId: string): Promise<Comment | null> {
		await this.#checkPermission("list", ctx);
		const doc = await this.#model.findById(commentId).lean<CommentDoc>();
		if (!doc) return null;
		return this.#hydrate(ctx, [doc]).then((arr) => arr[0]);
	}

	async count(ctx: CommentPermissionContext, target: { targetType: string; targetId: string }): Promise<number> {
		await this.#checkPermission("list", ctx);
		return this.#model.countDocuments({ targetType: target.targetType, targetId: target.targetId, deleted: false });
	}

	// ---------------- Drafts ----------------

	async saveDraft(ctx: CommentPermissionContext, key: DraftKey, payload: DraftPayload): Promise<CommentDraft> {
		await this.#checkPermission("create", ctx);
		return this.#drafts.save(ctx.userId, key, payload);
	}

	async getDraft(ctx: CommentPermissionContext, key: DraftKey): Promise<CommentDraft | null> {
		// Auth-gate: el draft pertenece al user, pero solo lo dejamos consultar a
		// quien tenga permiso "create" sobre el target (alineado con saveDraft).
		// Esto cierra un side-channel para usuarios que perdieron acceso al recurso.
		await this.#checkPermission("create", ctx);
		return this.#drafts.get(ctx.userId, key);
	}

	async deleteDraft(ctx: CommentPermissionContext, key: DraftKey): Promise<void> {
		await this.#checkPermission("create", ctx);
		await this.#drafts.delete(ctx.userId, key);
	}

	// ---------------- helpers ----------------

	#validateEmoji(emoji: string): string {
		if (typeof emoji !== "string") throw err(400, "COMMENT_BAD_EMOJI", "Emoji inválido");
		const trimmed = emoji.trim();
		if (
			!trimmed ||
			trimmed.length > COMMENT_REACTION_MAX_EMOJI_LENGTH ||
			EMOJI_DENY.test(trimmed) ||
			trimmed.includes(".") ||
			trimmed.includes("$")
		) {
			throw err(400, "COMMENT_BAD_EMOJI", "Emoji inválido");
		}
		return trimmed;
	}

	async #hydrate(ctx: CommentPermissionContext, docs: CommentDoc[]): Promise<Comment[]> {
		if (!docs.length) return [];
		const allIds = new Set<string>();
		for (const d of docs) for (const id of d.attachmentIds) allIds.add(id);
		let dtoMap = new Map<string, AttachmentDTO>();
		if (allIds.size > 0 && this.#attachments) {
			const found = await this.#attachments.getMany(ctx as any, [...allIds]);
			dtoMap = new Map(found.map((a) => [a.id, this.#attachments!.toDto(a)]));
		}
		return docs.map((d) => this.#docToComment(d, dtoMap));
	}

	#docToComment(doc: CommentDoc, dtoMap?: Map<string, AttachmentDTO>): Comment {
		return {
			id: String(doc._id),
			targetType: doc.targetType,
			targetId: doc.targetId,
			parentId: doc.parentId,
			threadRootId: doc.threadRootId,
			depth: doc.depth,
			authorId: doc.authorId,
			authorName: doc.authorName,
			authorImage: doc.authorImage,
			blocks: doc.deleted ? [] : (doc.blocks as Block[]),
			attachments: doc.attachmentIds.map((id) => dtoMap?.get(id)).filter((x): x is AttachmentDTO => Boolean(x)),
			reactions: doc.reactions ?? {},
			replyCount: doc.replyCount ?? 0,
			label: doc.label as CommentLabel | undefined,
			meta: doc.meta,
			createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
			updatedAt: doc.updatedAt ? (doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : String(doc.updatedAt)) : undefined,
			edited: !!doc.edited,
			deleted: !!doc.deleted,
		};
	}

	#docToCommentNoAttachments(doc: CommentDoc): Comment {
		return this.#docToComment(doc, new Map());
	}
}
