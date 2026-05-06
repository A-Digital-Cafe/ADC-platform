import type { Connection } from "mongoose";
import { BaseUtility } from "../../BaseUtility.js";
import { getOrCreateCommentModel } from "./schemas/comment.schema.js";
import { getOrCreateCommentDraftModel } from "./schemas/draft.schema.js";
import {
	CommentsManager,
	type CommentsManagerOptions,
	type CommentPermissionChecker,
	type CommentPermissionContext,
	type CommentAction,
	type CreateInput,
	type UpdateInput,
	type ListOptions,
	type ThreadOptions,
	type DraftKey,
	type DraftPayload,
} from "./managers/CommentsManager.js";

export type {
	CommentsManagerOptions,
	CommentPermissionChecker,
	CommentPermissionContext,
	CommentAction,
	CreateInput,
	UpdateInput,
	ListOptions,
	ThreadOptions,
	DraftKey,
	DraftPayload,
};
export { CommentsManager };

export interface CreateCommentsManagerOptions extends Omit<CommentsManagerOptions, "commentModel" | "draftModel"> {
	mongoConnection: Connection;
	collectionName: string;
	draftCollectionName?: string;
}

export default class CommentsUtility extends BaseUtility {
	public readonly name = "comments-utility";

	createCommentsManager(opts: CreateCommentsManagerOptions): CommentsManager {
		const draftCol = opts.draftCollectionName ?? `${opts.collectionName}_drafts`;
		const commentModel = getOrCreateCommentModel(opts.mongoConnection, opts.collectionName);
		const draftModel = getOrCreateCommentDraftModel(opts.mongoConnection, draftCol);
		return new CommentsManager({
			commentModel,
			draftModel,
			attachmentsManager: opts.attachmentsManager,
			permissionChecker: opts.permissionChecker,
			maxThreadDepth: opts.maxThreadDepth,
			maxBlocksPerComment: opts.maxBlocksPerComment,
			editWindowMs: opts.editWindowMs,
		});
	}
}
