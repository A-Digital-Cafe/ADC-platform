import type { Block } from "../../ADC/types/learning.js";
import type { AttachmentDTO } from "../attachments/Attachment.js";

/**
 * Tipo polimórfico de Comentario reutilizado por todos los servicios.
 * Almacenado en colecciones dedicadas por servicio (`issue_comments`, `article_comments`).
 */

export type CommentLabel = "transition-reason";

export interface Comment {
	id: string;
	targetType: string;
	targetId: string;
	parentId: string | null;
	threadRootId: string;
	depth: number;
	authorId: string;
	authorName?: string;
	authorImage?: string;
	blocks: Block[];
	attachments: AttachmentDTO[];
	reactions: Record<string, string[]>;
	replyCount: number;
	label?: CommentLabel;
	meta?: Record<string, unknown>;
	createdAt: string;
	updatedAt?: string;
	edited: boolean;
	deleted: boolean;
}

export interface CommentDraft {
	id: string;
	ownerId: string;
	targetType: string;
	targetId: string;
	parentId: string | null;
	editingCommentId: string | null;
	blocks: Block[];
	attachmentIds: string[];
	updatedAt: string;
}

export interface CommentsPage {
	items: Comment[];
	nextCursor: string | null;
}

export interface CreateCommentInput {
	parentId?: string | null;
	blocks: Block[];
	attachmentIds?: string[];
	label?: CommentLabel;
	meta?: Record<string, unknown>;
}

export interface UpdateCommentInput {
	blocks: Block[];
	attachmentIds?: string[];
}

export interface ReactionInput {
	emoji: string;
}

export const COMMENT_MAX_BLOCKS = 50;
export const COMMENT_MAX_DEPTH = 3;
export const COMMENT_MAX_ATTACHMENTS = 10;
export const COMMENT_REACTION_MAX_EMOJI_LENGTH = 16;
