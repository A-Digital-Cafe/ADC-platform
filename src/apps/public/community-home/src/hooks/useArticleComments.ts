import { useCallback, useEffect, useState } from "react";
import type { Block } from "@common/ADC/types/learning.js";
import type { Comment } from "@common/types/comments/Comment.js";
import type { CommentsSectionSubmitDetail, Block as StencilBlock } from "@ui-library/utils/react-jsx";
import { getSession } from "@ui-library/utils/session";
import { socialApi, buildCommentsTree, type CommentTreeNode } from "../utils/social-api";
import { useCommentAttachmentUrls } from "./useCommentAttachmentUrls";
import { makeRequestAttachmentHandler } from "./uploadArticleAttachment";

const PAGE_LIMIT = 30;

export interface DraftChangeDetail {
	parentId: string | null;
	editingCommentId: string | null;
	blocks: StencilBlock[];
	attachmentIds: string[];
}

export interface RequestAttachmentDetail {
	kind: "image" | "file";
	parentId: string | null;
	editingCommentId: string | null;
}

/**
 * Hook que centraliza el estado y handlers de la sección de comentarios
 * de un artículo (lista plana + árbol + drafts root + URLs de adjuntos).
 */
export function useArticleComments(slug: string) {
	const [flat, setFlat] = useState<Comment[]>([]);
	const [tree, setTree] = useState<CommentTreeNode[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [posting, setPosting] = useState(false);
	const [draftBlocks, setDraftBlocks] = useState<Block[]>([]);
	const [draftAttachmentIds, setDraftAttachmentIds] = useState<string[]>([]);
	const { urls: attachmentUrls, addUrl } = useCommentAttachmentUrls(slug, flat);

	useEffect(() => {
		setTree(buildCommentsTree(flat));
	}, [flat]);

	const loadInitial = useCallback(async () => {
		// El backend exige permiso `list` para listar comentarios. Evitamos
		// llamar al endpoint cuando no hay sesión para no provocar errores 403.
		const session = await getSession();
		if (!session.authenticated) {
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const [page, draft] = await Promise.all([
				socialApi.listComments(slug, { limit: PAGE_LIMIT }),
				socialApi.getDraft(slug, { parentId: null, editingCommentId: null }).catch(() => null),
			]);
			setFlat(page.items);
			setCursor(page.nextCursor);
			setHasMore(!!page.nextCursor);
			if (draft) {
				setDraftBlocks(draft.blocks ?? []);
				setDraftAttachmentIds(draft.attachmentIds ?? []);
			}
		} finally {
			setLoading(false);
		}
	}, [slug]);

	const loadMore = useCallback(async () => {
		if (!cursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const page = await socialApi.listComments(slug, { cursor, limit: PAGE_LIMIT });
			setFlat((prev) => [...prev, ...page.items]);
			setCursor(page.nextCursor);
			setHasMore(!!page.nextCursor);
		} finally {
			setLoadingMore(false);
		}
	}, [slug, cursor, loadingMore]);

	const submit = useCallback(
		async (detail: CommentsSectionSubmitDetail) => {
			setPosting(true);
			try {
				if (detail.editingCommentId) {
					const updated = await socialApi.updateComment(slug, detail.editingCommentId, {
						blocks: detail.blocks as Block[],
						attachmentIds: detail.attachmentIds,
					});
					if (updated) setFlat((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
					return;
				}
				const created = await socialApi.createComment(slug, {
					blocks: detail.blocks as Block[],
					parentId: detail.parentId,
					attachmentIds: detail.attachmentIds,
				});
				if (!created) return;
				setFlat((prev) => [created, ...prev]);
				if (!detail.parentId) {
					setDraftBlocks([]);
					setDraftAttachmentIds([]);
					void socialApi.deleteDraft(slug, { parentId: null, editingCommentId: null });
				}
			} finally {
				setPosting(false);
			}
		},
		[slug]
	);

	const remove = useCallback(
		async (commentId: string) => {
			const ok = await socialApi.deleteComment(slug, commentId);
			if (ok) setFlat((prev) => prev.map((c) => (c.id === commentId ? { ...c, deleted: true, blocks: [] } : c)));
		},
		[slug]
	);

	const reactToggle = useCallback(
		async (detail: { commentId: string; emoji: string; reacted: boolean }) => {
			const updated = detail.reacted
				? await socialApi.unreactComment(slug, detail.commentId, detail.emoji)
				: await socialApi.reactComment(slug, detail.commentId, detail.emoji);
			if (updated) setFlat((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
		},
		[slug]
	);

	const draftChange = useCallback(
		async (detail: DraftChangeDetail) => {
			if (detail.parentId !== null || detail.editingCommentId !== null) return;
			setDraftBlocks(detail.blocks as Block[]);
			setDraftAttachmentIds(detail.attachmentIds);
			if (detail.blocks.length === 0 && detail.attachmentIds.length === 0) {
				await socialApi.deleteDraft(slug, { parentId: null, editingCommentId: null });
			} else {
				await socialApi.saveDraft(slug, {
					blocks: detail.blocks as Block[],
					attachmentIds: detail.attachmentIds,
					parentId: null,
					editingCommentId: null,
				});
			}
		},
		[slug]
	);

	const requestAttachment = useCallback(
		makeRequestAttachmentHandler(
			slug,
			addUrl,
			(b) => setDraftBlocks((prev) => [...prev, b]),
			(id) => setDraftAttachmentIds((prev) => [...prev, id])
		),
		[slug, addUrl]
	);

	return {
		comments: tree,
		flat,
		hasMore,
		loading,
		loadingMore,
		posting,
		draftBlocks,
		draftAttachmentIds,
		attachmentUrls,
		loadInitial,
		loadMore,
		submit,
		remove,
		reactToggle,
		draftChange,
		requestAttachment,
	};
}
