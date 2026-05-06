import { useCallback, useEffect, useRef, useState } from "react";
import type { Block } from "@common/ADC/types/learning.ts";
import type { CommentsSectionSubmitDetail, Block as StencilBlock } from "@ui-library/utils/react-jsx";
import type { CallerCtx } from "../utils/permissions.ts";
import { pmApi, buildCommentsTree, type CommentTreeNode, type Comment } from "../utils/pm-api.ts";

interface RequestAttachmentDetail {
	kind: "image" | "file";
	parentId: string | null;
	editingCommentId: string | null;
}

interface DraftChangeDetail {
	parentId: string | null;
	editingCommentId: string | null;
	blocks: StencilBlock[];
	attachmentIds: string[];
}

interface Props {
	issueId: string;
	caller?: CallerCtx;
	canComment?: boolean;
	canModerate?: boolean;
}

const COMMENT_PAGE_LIMIT = 20;

export function IssueComments({ issueId, caller, canComment = true, canModerate = false }: Props) {
	const [flatComments, setFlatComments] = useState<Comment[]>([]);
	const [comments, setComments] = useState<CommentTreeNode[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [posting, setPosting] = useState(false);

	const [rootDraftBlocks, setRootDraftBlocks] = useState<Block[]>([]);
	const [rootDraftAttachmentIds, setRootDraftAttachmentIds] = useState<string[]>([]);
	const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
	const requestedAttachmentRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		setComments(buildCommentsTree(flatComments) as CommentTreeNode[]);
	}, [flatComments]);

	useEffect(() => {
		(async () => {
			setLoading(true);
			try {
				const [pageRes, draftRes] = await Promise.all([
					pmApi.listIssueComments(issueId, { limit: COMMENT_PAGE_LIMIT }),
					pmApi.getIssueCommentDraft(issueId, { parentId: null, editingCommentId: null }).catch(() => null),
				]);
				if (pageRes.success && pageRes.data) {
					setFlatComments(pageRes.data.items);
					setCursor(pageRes.data.nextCursor ?? null);
					setHasMore(!!pageRes.data.nextCursor);
				}
				if (draftRes?.success && draftRes.data?.draft) {
					setRootDraftBlocks(draftRes.data.draft.blocks ?? []);
					setRootDraftAttachmentIds(draftRes.data.draft.attachmentIds ?? []);
				}
			} finally {
				setLoading(false);
			}
		})();
	}, [issueId]);

	// Resolve attachment URLs lazily for blocks that reference attachments
	useEffect(() => {
		const ids = new Set<string>();
		const collect = (nodes: CommentTreeNode[]) => {
			for (const c of nodes) {
				for (const b of c.blocks ?? []) {
					if (b && typeof b === "object" && (b as { type?: string }).type === "attachment") {
						const aid = (b as { attachmentId?: string }).attachmentId;
						if (aid) ids.add(aid);
					}
				}
				for (const a of c.attachments ?? []) ids.add(a.id);
				if (c.children?.length) collect(c.children);
			}
		};
		collect(comments);
		const missing = [...ids].filter((id) => !attachmentUrls[id] && !requestedAttachmentRef.current.has(id));
		if (missing.length === 0) return;
		for (const id of missing) requestedAttachmentRef.current.add(id);
		(async () => {
			const updates: Record<string, string> = {};
			for (const id of missing) {
				const r = await pmApi.getIssueAttachmentDownloadUrl(issueId, id, { inline: true });
				if (r.success && r.data?.url) updates[id] = r.data.url;
			}
			if (Object.keys(updates).length) setAttachmentUrls((prev) => ({ ...prev, ...updates }));
		})();
	}, [comments, attachmentUrls, issueId]);

	const handleLoadMore = useCallback(async () => {
		if (!cursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const r = await pmApi.listIssueComments(issueId, { cursor, limit: COMMENT_PAGE_LIMIT });
			if (r.success && r.data) {
				const page = r.data;
				setFlatComments((prev) => [...prev, ...page.items]);
				setCursor(page.nextCursor ?? null);
				setHasMore(!!page.nextCursor);
			}
		} finally {
			setLoadingMore(false);
		}
	}, [issueId, cursor, loadingMore]);

	const handleSubmit = useCallback(
		async (detail: CommentsSectionSubmitDetail) => {
			setPosting(true);
			try {
				if (detail.editingCommentId) {
					const r = await pmApi.updateIssueComment(issueId, detail.editingCommentId, {
						blocks: detail.blocks as Block[],
						attachmentIds: detail.attachmentIds,
					});
					if (r.success && r.data) {
						const updated = r.data;
						setFlatComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
					}
				} else {
					const r = await pmApi.createIssueComment(issueId, {
						blocks: detail.blocks as Block[],
						parentId: detail.parentId,
						attachmentIds: detail.attachmentIds,
					});
					if (r.success && r.data) {
						const created = r.data;
						setFlatComments((prev) => [created, ...prev]);
						if (!detail.parentId) {
							setRootDraftBlocks([]);
							setRootDraftAttachmentIds([]);
							void pmApi.deleteIssueCommentDraft(issueId, { parentId: null, editingCommentId: null });
						}
					}
				}
			} finally {
				setPosting(false);
			}
		},
		[issueId]
	);

	const handleDelete = useCallback(
		async (commentId: string) => {
			const r = await pmApi.deleteIssueComment(issueId, commentId);
			if (r.success) {
				setFlatComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, deleted: true, blocks: [] } : c)));
			}
		},
		[issueId]
	);

	const handleReactToggle = useCallback(
		async (detail: { commentId: string; emoji: string; reacted: boolean }) => {
			const r = detail.reacted
				? await pmApi.unreactIssueComment(issueId, detail.commentId, detail.emoji)
				: await pmApi.reactIssueComment(issueId, detail.commentId, detail.emoji);
			if (r.success && r.data) {
				const updated = r.data;
				setFlatComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
			}
		},
		[issueId]
	);

	const handleDraftChange = useCallback(
		async (detail: DraftChangeDetail) => {
			if (detail.parentId !== null || detail.editingCommentId !== null) return;
			setRootDraftBlocks(detail.blocks as Block[]);
			setRootDraftAttachmentIds(detail.attachmentIds);
			if (detail.blocks.length === 0 && detail.attachmentIds.length === 0) {
				await pmApi.deleteIssueCommentDraft(issueId, { parentId: null, editingCommentId: null });
			} else {
				await pmApi.saveIssueCommentDraft(issueId, {
					blocks: detail.blocks as Block[],
					attachmentIds: detail.attachmentIds,
					parentId: null,
					editingCommentId: null,
				});
			}
		},
		[issueId]
	);

	const handleRequestAttachment = useCallback(
		(detail: RequestAttachmentDetail) => {
			if (detail.parentId !== null || detail.editingCommentId !== null) return;
			const input = globalThis.document.createElement("input");
			input.type = "file";
			if (detail.kind === "image") input.accept = "image/*";
			input.onchange = async () => {
				const file = input.files?.[0];
				if (!file) return;
				const presignRes = await pmApi.presignIssueAttachment(issueId, {
					fileName: file.name,
					mimeType: file.type || "application/octet-stream",
					size: file.size,
					forComment: true,
				});
				if (!presignRes.success || !presignRes.data) return;
				const presign = presignRes.data;
				const putRes = await fetch(presign.uploadUrl, {
					method: "PUT",
					body: file,
					headers: presign.headers,
				});
				if (!putRes.ok) return;
				const confirm = await pmApi.confirmIssueAttachment(issueId, presign.attachmentId);
				if (!confirm.success || !confirm.data) return;
				const att = confirm.data;
				const dl = await pmApi.getIssueAttachmentDownloadUrl(issueId, att.id, { inline: true });
				if (dl.success && dl.data?.url) {
					const url = dl.data.url;
					setAttachmentUrls((prev) => ({ ...prev, [att.id]: url }));
				}
				const newBlock: Block = {
					type: "attachment",
					kind: detail.kind,
					attachmentId: att.id,
					fileName: att.fileName,
					mimeType: att.mimeType,
					size: att.size,
				};
				setRootDraftBlocks((prev) => [...prev, newBlock]);
				setRootDraftAttachmentIds((prev) => [...prev, att.id]);
			};
			input.click();
		},
		[issueId]
	);

	return (
		<adc-comments-section
			comments={comments}
			session={{
				authenticated: !!caller?.userId,
				userId: caller?.userId,
				canComment,
				canModerate,
			}}
			submitting={posting}
			loading={loading}
			hasMore={hasMore}
			loadingMore={loadingMore}
			attachmentUrls={attachmentUrls}
			initialDraftBlocks={rootDraftBlocks as StencilBlock[]}
			initialDraftAttachmentIds={rootDraftAttachmentIds}
			onadcSubmit={(ev) => {
				void handleSubmit(ev.detail);
			}}
			onadcDelete={(ev) => {
				void handleDelete(ev.detail);
			}}
			onadcReactToggle={(ev) => {
				void handleReactToggle(ev.detail);
			}}
			onadcLoadMore={() => {
				void handleLoadMore();
			}}
			onadcDraftChange={(ev) => {
				void handleDraftChange(ev.detail);
			}}
			onadcRequestAttachment={(ev) => handleRequestAttachment(ev.detail)}
		/>
	);
}
